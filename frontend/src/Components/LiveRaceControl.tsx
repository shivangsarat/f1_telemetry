import { useEffect, useRef, useState } from 'react';
import {
    getCurrentTrackCondition,
    getRaceControlEventTheme,
    getTrackConditionTheme
} from '../Utils/raceControlTheme';

const eventKey = (message: any) =>
    String(
        message?._id
        ?? message?._key
        ?? `${message?.date || ''}|${message?.category || ''}|${message?.message || message?.text || ''}`
    );

export const RaceControlToastOnly = ({
    messages,
    sessionKey,
    enabled = true
}: {
    messages: any[];
    sessionKey?: string | number | null;
    enabled?: boolean;
}) => {
    const [latestToast, setLatestToast] = useState<any>(null);
    const baselineReadyRef = useRef(false);
    const lastKeyRef = useRef<string | null>(null);
    const sessionRef = useRef<string | number | null | undefined>(sessionKey);

    useEffect(() => {
        if (!enabled) {
            setLatestToast(null);
            return;
        }

        if (sessionRef.current !== sessionKey) {
            sessionRef.current = sessionKey;
            baselineReadyRef.current = false;
            lastKeyRef.current = null;
            setLatestToast(null);
        }

        const newest = messages?.[0];

        // Existing race-control history is baseline when a page opens. Only a
        // row that arrives afterwards becomes a toast.
        if (!baselineReadyRef.current) {
            baselineReadyRef.current = true;
            if (newest) lastKeyRef.current = eventKey(newest);
            return;
        }

        if (!newest) return;
        const key = eventKey(newest);
        if (key === lastKeyRef.current) return;

        lastKeyRef.current = key;
        setLatestToast(newest);
    }, [enabled, messages, sessionKey]);

    useEffect(() => {
        if (!latestToast) return;
        const timer = window.setTimeout(() => setLatestToast(null), 10000);
        return () => window.clearTimeout(timer);
    }, [latestToast]);

    if (!enabled || !latestToast) return null;

    const theme = getRaceControlEventTheme(latestToast);

    return (
        <div className="fixed bottom-6 right-6 z-[80] w-[380px] max-w-[calc(100vw-3rem)]">
            <div className={`w-full border-l-4 ${theme.frameClass} bg-gray-900/95 shadow-2xl pl-3 py-3 pr-3 rounded-xl border backdrop-blur-md`}>
                <div className="flex justify-between items-start gap-3 mb-1">
                    <span className="text-[10px] text-gray-400 font-mono tracking-widest uppercase font-bold">
                        {latestToast.date ? new Date(latestToast.date).toLocaleTimeString() : '--:--'} | NEW ALERT
                    </span>
                    <div className="flex items-center gap-2">
                        <span className={`text-sm leading-none font-black ${theme.accentTextClass}`}>
                            {theme.icon}
                        </span>
                        <button
                            type="button"
                            onClick={() => setLatestToast(null)}
                            className="w-6 h-6 rounded border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 flex items-center justify-center text-sm font-black"
                            aria-label="Close race control alert"
                        >
                            ×
                        </button>
                    </div>
                </div>
                <div className={`text-[9px] uppercase tracking-[0.16em] font-black mb-1 ${theme.accentTextClass}`}>
                    {theme.label}
                </div>
                <span className={`${theme.accentTextClass} leading-snug font-bold block text-sm pr-6`}>
                    {latestToast.message || latestToast.text}
                </span>
            </div>
        </div>
    );
};

export const TrackConditionFrame = ({ messages, enabled = true }: { messages: any[]; enabled?: boolean }) => {
    if (!enabled) return null;

    const condition = getCurrentTrackCondition(messages);
    if (condition === 'neutral') return null;

    const theme = getTrackConditionTheme(condition);

    return (
        <>
            <div
                aria-hidden="true"
                className={`fixed inset-0 z-[70] pointer-events-none border-2 ${theme.frameClass} transition-all duration-300`}
            />
            <div
                aria-hidden="true"
                className={`fixed top-0 left-0 right-0 z-[70] h-1 pointer-events-none ${theme.panelBorderClass.replace('border-', 'bg-')}`}
            />
        </>
    );
};
