import { useEffect, useState, useMemo, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Table } from '../Utils/Table';
import { useRaceStore } from '../store/useRaceStore';
import { WeatherCard, SessionBestsCard, RaceControlWidget, DriverExpandedRow } from '../Components/DashboardWidgets';
import { getTyreColor } from '../Utils/helpers';
import { LiveTrackerWidget } from '../Components/LiveTrackMap';
import { DriverBadges } from '../Components/DriverBadges';

export const Dashboard = () => {
    const { sessionKey } = useParams();
    const navigate = useNavigate();
    const isLiveSession = sessionKey === 'live';

    const initialHistoricalData = !isLiveSession && sessionKey
        ? useRaceStore.getState().historicalRaces[String(sessionKey)]
        : null;

    const [histData, setHistData] = useState<any>(() => initialHistoricalData
        ? { ...initialHistoricalData, loading: false }
        : {
            results: [], weather: null, sessionBests: null, isRace: true,
            maxRaceLap: 0, availableSessions: [], loading: !isLiveSession
        }
    );
    const [histRaceControl, setHistRaceControl] = useState<any[]>(() => initialHistoricalData?.raceControl || []);
    const [latestToast, setLatestToast] = useState<any>(null);
    const [showScrollTop, setShowScrollTop] = useState(false);
    const [scrollTopDismissed, setScrollTopDismissed] = useState(false);
    const [sessionClockNow, setSessionClockNow] = useState(() => Date.now());
    const resultsScrollRef = useRef<HTMLDivElement>(null);
    const raceControlBaselineReadyRef = useRef(false);
    const lastRaceControlKeyRef = useRef<string | null>(null);
    const lastRaceControlSessionRef = useRef<any>(null);

    const connect = useRaceStore(state => state.connect);
    const liveRace = useRaceStore(state => state.liveRace);
    const cacheHistoricalRace = useRaceStore(state => state.cacheHistoricalRace);

    useEffect(() => {
        if (isLiveSession) {
            connect();
            return;
        }

        const key = String(sessionKey || '');
        if (!key) return;

        const cached = useRaceStore.getState().historicalRaces[key];
        if (cached) {
            setHistData({ ...cached, loading: false });
            setHistRaceControl(cached.raceControl || []);
            return;
        }

        const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:8080';
        setHistData((prev: any) => ({ ...prev, loading: true }));

        fetch(`${API_BASE}/api/race-details/${key}`).then(r => r.json())
            .then(data => {
                cacheHistoricalRace(key, data);
                setHistData({ ...data, loading: false });
                setHistRaceControl(data.raceControl || []);
            })
            .catch(() => setHistData((prev: any) => ({ ...prev, loading: false })));
    }, [sessionKey, isLiveSession, connect, cacheHistoricalRace]);

    const activeResults = isLiveSession ? (liveRace?.results || []) : (histData.results || []);
    const activeWeather = isLiveSession ? liveRace?.weather : histData.weather;
    const activeBests = isLiveSession ? liveRace?.sessionBests : histData.sessionBests;
    const isRaceMode = isLiveSession ? Boolean(liveRace?.isRace) : Boolean(histData.isRace);
    const activeMaxLap = isLiveSession ? Number(liveRace?.maxRaceLap || 0) : Number(histData.maxRaceLap || 0);
    const scheduledTotalLaps = isLiveSession
        ? Number(liveRace?.scheduledTotalLaps || 0)
        : Number(histData.scheduledTotalLaps || 0);
    const displayedRaceLaps = scheduledTotalLaps > 0 ? scheduledTotalLaps : activeMaxLap;
    const activeRaceControl = isLiveSession ? (liveRace?.raceControl || []) : histRaceControl;
    const availableSessions = isLiveSession ? (liveRace?.availableSessions || []) : (histData.availableSessions || []);
    const activeSessionInfo = isLiveSession ? liveRace?.sessionInfo : histData.sessionInfo;
    const activeMeetingInfo = isLiveSession ? liveRace?.meetingInfo : histData.meetingInfo;
    const raceName =
        activeMeetingInfo?.meeting_name
        || activeSessionInfo?.meeting_name
        || (activeSessionInfo?.location ? `${activeSessionInfo.location} Grand Prix` : 'Grand Prix');
    const activeSessionName = activeSessionInfo?.session_name || activeSessionInfo?.session_type || '';

    const sessionStartMs = activeSessionInfo?.date_start ? new Date(activeSessionInfo.date_start).getTime() : NaN;
    const sessionEndMs = activeSessionInfo?.date_end ? new Date(activeSessionInfo.date_end).getTime() : NaN;
    const scheduledSessionDurationMs = Number.isFinite(sessionStartMs) && Number.isFinite(sessionEndMs)
        ? Math.max(0, sessionEndMs - sessionStartMs)
        : 0;
    const remainingSessionMs = isLiveSession && Number.isFinite(sessionEndMs)
        ? Math.max(0, sessionEndMs - sessionClockNow)
        : scheduledSessionDurationMs;
    const formatSessionClock = (durationMs: number) => {
        if (!Number.isFinite(durationMs) || durationMs <= 0) return '--:--';
        const totalSeconds = Math.max(0, Math.ceil(durationMs / 1000));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return hours > 0
            ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
            : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    };
    const displayedSessionClock = formatSessionClock(remainingSessionMs);

    const raceControlEventKey = (message: any) =>
        String(
            message?._id
            ?? message?._key
            ?? `${message?.date || ''}|${message?.category || ''}|${message?.message || message?.text || ''}`
        );

    useEffect(() => {
        if (!isLiveSession || !liveRace) return;

        const currentSession = liveRace.sessionInfo?.session_key ?? 'live';
        if (lastRaceControlSessionRef.current !== currentSession) {
            lastRaceControlSessionRef.current = currentSession;
            raceControlBaselineReadyRef.current = false;
            lastRaceControlKeyRef.current = null;
            setLatestToast(null);
        }

        const newest = activeRaceControl[0];

        // First snapshot after joining a live session is baseline state, not a new alert.
        // If that baseline is empty, the first subsequently-arriving race-control row
        // is treated as genuinely new and will toast once.
        if (!raceControlBaselineReadyRef.current) {
            raceControlBaselineReadyRef.current = true;
            if (newest) lastRaceControlKeyRef.current = raceControlEventKey(newest);
            return;
        }

        if (!newest) return;

        const key = raceControlEventKey(newest);
        if (key === lastRaceControlKeyRef.current) return;

        lastRaceControlKeyRef.current = key;
        setLatestToast(newest);
    }, [activeRaceControl, isLiveSession, liveRace]);

    useEffect(() => {
        if (!latestToast) return;
        const timer = setTimeout(() => setLatestToast(null), 10000);
        return () => clearTimeout(timer);
    }, [latestToast]);

    useEffect(() => {
        if (isRaceMode || !isLiveSession) return;
        setSessionClockNow(Date.now());
        const timer = window.setInterval(() => setSessionClockNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [isRaceMode, isLiveSession, activeSessionInfo?.session_key, activeSessionInfo?.date_end]);

    const updateScrollTopVisibility = () => {
        const tableScrollTop = resultsScrollRef.current?.scrollTop || 0;
        const pageScrollTop = window.scrollY || document.documentElement.scrollTop || 0;
        const shouldShow = Math.max(tableScrollTop, pageScrollTop) > 320;
        setShowScrollTop(shouldShow);
        if (!shouldShow) setScrollTopDismissed(false);
    };

    const handleResultsScroll = () => updateScrollTopVisibility();

    useEffect(() => {
        window.addEventListener('scroll', updateScrollTopVisibility, { passive: true });
        return () => window.removeEventListener('scroll', updateScrollTopVisibility);
    }, []);

    const driverColumns = useMemo(() => [
        { 
            header: 'Pos', 
            accessor: (row: any) => (
                <div className="flex flex-col items-center">
                    <span className="font-bold text-white text-sm">{row.position}</span>
                    {isRaceMode && row.pos_change !== 0 && (
                        <span className={`text-[10px] font-bold mt-0.5 ${row.pos_change > 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {row.pos_change > 0 ? '▲' : '▼'} {Math.abs(row.pos_change)}
                        </span>
                    )}
                </div>
            )
        },
        { 
            header: 'Driver', 
            accessor: (row: any) => {
                const isRetired = row.status === 'DNF' || row.status === 'DNS';
                return (
                    <div className="flex items-center gap-2">
                        <div className="w-1 h-4 rounded" style={{ backgroundColor: `#${row.team_color}` }}></div>
                        <Link to={`/race/${sessionKey}/driver/${row.driver_number}`} onClick={(e) => e.stopPropagation()} className={`font-bold hover:underline ${isRetired ? 'text-gray-500' : 'text-blue-400'}`}>
                            {row.name} ({row.driver_number})
                        </Link>
                        <DriverBadges driver={row} compact />
                        {isRetired && <span className="bg-red-900/30 text-red-500 text-[9px] px-1.5 py-0.5 rounded font-black uppercase tracking-widest border border-red-800/50 shadow-sm ml-2">{row.status}</span>}
                    </div>
                );
            } 
        },
        { header: 'Laps', accessor: (row: any) => <span className={`font-mono ${row.status === 'DNF' || row.status === 'DNS' ? 'text-gray-500' : 'text-gray-300'}`}>{row.driver_laps}</span> },
        { 
            header: isRaceMode ? 'Time' : 'Best Lap', 
            accessor: (row: any) => <span className={`font-mono ${row.status === 'DNF' || row.status === 'DNS' ? 'text-gray-500' : 'text-gray-300'}`}>{isRaceMode ? row.total_time : row.best_lap}</span> 
        },
        { 
            header: 'Interval', 
            accessor: (row: any) => <span className={`font-mono ${row.status === 'DNF' || row.status === 'DNS' ? 'text-gray-500' : 'text-gray-300'}`}>{row.interval}</span> 
        },
        { 
            header: isRaceMode ? 'Gap' : 'Gap to P1', 
            accessor: (row: any) => {
                const isRetired = row.status === 'DNF' || row.status === 'DNS';
                const currentStint = row.stints?.[row.stints.length - 1];

                return (
                    <div className="flex items-center justify-between w-full pr-4">
                        <span className={`font-mono ${isRetired ? 'text-gray-500' : 'text-gray-300'}`}>
                            {row.gap_to_leader}
                        </span>
                        
                        {!isRetired && currentStint ? (
                            <div className="flex items-center gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                                    {currentStint.compound} ({currentStint.length}L)
                                </span>
                                <div 
                                    className="w-2.5 h-2.5 rounded-full border border-gray-700 shadow-sm" 
                                    style={{ backgroundColor: getTyreColor(currentStint.compound) }} 
                                />
                            </div>
                        ) : (
                            <span className="text-[10px] uppercase tracking-widest text-red-500/70 font-bold group-hover:text-red-400 transition-colors">
                                {row.status !== 'Active' ? row.status : ''}
                            </span>
                        )}
                    </div>
                );
            }
        }
    ], [isRaceMode, sessionKey]);

    return (
        <div className="flex min-h-screen bg-black text-white p-4 gap-6 overflow-hidden relative">
            <RaceControlWidget
                messages={activeRaceControl}
                latestToast={latestToast}
                onCloseToast={() => setLatestToast(null)}
            />

            <div className="flex-1 flex flex-col gap-6 overflow-y-auto relative z-10">
                <div className="flex justify-between items-center">
                    
                    <div className="flex items-center gap-6 min-w-0 flex-wrap">
                        <Link to="/" className="text-gray-400 hover:text-white uppercase tracking-widest text-sm font-bold shrink-0">← Back</Link>

                        <div className="min-w-[210px]">
                            <div className="flex items-center gap-2">
                                {isLiveSession && <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0" />}
                                <h1 className="text-lg font-black uppercase tracking-wide text-white truncate">
                                    {raceName}
                                </h1>
                            </div>
                            <div className="text-[10px] uppercase tracking-[0.18em] font-bold text-gray-500 mt-0.5">
                                {isLiveSession ? 'Live · ' : ''}{activeSessionName || (isRaceMode ? 'Race' : 'Session')}
                            </div>
                        </div>
                        
                        <div className="flex gap-2 bg-gray-900/50 p-1 rounded-lg flex-wrap">
                            {availableSessions.map((s: any) => {
                                const isFuture = new Date(s.date_start).getTime() > Date.now();
                                const isActive = isLiveSession
                                    ? String(activeSessionInfo?.session_key ?? '') === String(s.session_key)
                                    : sessionKey === String(s.session_key);

                                return (
                                    <button
                                        key={s.session_key}
                                        onClick={() => navigate(`/race/${s.session_key}`)}
                                        disabled={isFuture}
                                        className={`px-4 py-2 text-xs font-bold tracking-widest rounded-md transition-all ${
                                            isActive 
                                                ? isLiveSession
                                                    ? 'bg-green-600/20 text-green-300 border border-green-500/40 shadow-lg'
                                                    : 'bg-red-600 text-white shadow-lg'
                                                : isFuture
                                                    ? 'text-gray-700 cursor-not-allowed opacity-50'
                                                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                                        }`}
                                    >
                                        {s.session_name.toUpperCase()}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        {isLiveSession && (
                            <Link
                                to={`/race/${sessionKey}/tracker`}
                                className="bg-gray-900 border border-green-500/30 px-4 py-1.5 rounded-full shadow-lg flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-green-400 hover:border-green-400/60"
                            >
                                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                Live Tracker
                            </Link>
                        )}
                    {isRaceMode ? (
                        displayedRaceLaps > 0 && (
                            <div
                                className="bg-gray-900 border border-gray-700 px-4 py-1.5 rounded-full shadow-lg flex items-center gap-3"
                                title={scheduledTotalLaps > 0 ? 'Scheduled race distance' : 'Scheduled distance unavailable; showing laps observed so far'}
                            >
                                <div className={`w-2 h-2 rounded-full ${isLiveSession ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`}></div>
                                <span className="font-bold uppercase tracking-widest text-xs text-gray-400">Race Laps</span>
                                <span className="font-black text-white font-mono text-sm">{displayedRaceLaps}</span>
                            </div>
                        )
                    ) : (
                        <div
                            className="bg-gray-900 border border-gray-700 px-4 py-1.5 rounded-full shadow-lg flex items-center gap-3"
                            title={isLiveSession ? 'Estimated session time remaining' : 'Scheduled session duration'}
                        >
                            <div className={`w-2 h-2 rounded-full ${isLiveSession ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`}></div>
                            <span className="font-bold uppercase tracking-widest text-xs text-gray-400">
                                {isLiveSession ? 'Session Time' : 'Session Duration'}
                            </span>
                            <span className="font-black text-white font-mono text-sm tabular-nums">{displayedSessionClock}</span>
                        </div>
                    )}
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <WeatherCard weather={activeWeather} />
                    <SessionBestsCard bests={activeBests} />
                </div>

                {isLiveSession && (
                    <LiveTrackerWidget
                        tracker={liveRace?.tracker}
                        sessionKey={sessionKey}
                        sticky
                        defaultMinimized
                    />
                )}

                <div className="bg-gray-900 rounded-xl border border-gray-800 flex-1 flex flex-col overflow-hidden shadow-2xl">
                    <div ref={resultsScrollRef} onScroll={handleResultsScroll} className="overflow-y-auto flex-1 custom-scrollbar relative pb-24">
                        {(isLiveSession ? !liveRace : histData.loading) ? (
                            <div className="p-10 text-center text-gray-500 animate-pulse">Fetching Session Data...</div>
                        ) : (
                            <Table 
                                data={activeResults || []} 
                                columns={driverColumns} 
                                getRowKey={(row: any) => row.driver_number}
                                expandableRender={(row) => <DriverExpandedRow driver={row} isLive={isLiveSession} isRaceMode={isRaceMode} liveStandings={undefined} />}
                            />
                        )}
                    </div>
                </div>
            </div>

            {showScrollTop && !scrollTopDismissed && (
                <div className="fixed right-6 bottom-24 z-50 flex items-center rounded-lg border border-gray-700 bg-gray-900/95 shadow-xl overflow-hidden">
                    <button
                        type="button"
                        onClick={() => {
                            resultsScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="px-4 py-2.5 text-xs font-black uppercase tracking-widest text-blue-400 hover:bg-gray-800 hover:text-blue-300"
                    >
                        ↑ Scroll to top
                    </button>
                    <button
                        type="button"
                        onClick={() => setScrollTopDismissed(true)}
                        className="px-3 py-2.5 border-l border-gray-700 text-gray-500 hover:text-white hover:bg-gray-800"
                        aria-label="Hide scroll to top"
                    >
                        ×
                    </button>
                </div>
            )}
        </div>
    );
};