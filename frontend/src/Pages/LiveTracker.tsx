import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useRaceStore } from '../store/useRaceStore';
import { LiveTrackMap } from '../Components/LiveTrackMap';
import { BroadcastSyncControl } from '../Components/BroadcastSyncControl';

export const LiveTracker = () => {
    const { sessionKey } = useParams();
    const connect = useRaceStore(state => state.connect);
    const liveRace = useRaceStore(state => state.liveRace);
    const connected = useRaceStore(state => state.connected);
    const isLive = sessionKey === 'live' || sessionKey === 'latest';

    useEffect(() => {
        if (isLive) connect();
    }, [isLive, connect]);

    return (
        <div className="min-h-screen bg-black text-white p-6 flex flex-col gap-6">
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-5">
                    <Link
                        to={`/race/${sessionKey}`}
                        className="text-gray-400 hover:text-white uppercase tracking-widest text-sm font-bold"
                    >
                        ← Back to Race
                    </Link>
                    <div>
                        <h1 className="text-2xl font-black uppercase tracking-wide">Live Driver Tracker</h1>
                        <p className="text-xs text-gray-500 mt-1">
                            Approximate positions from OpenF1 location telemetry.
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3 flex-wrap justify-end">
                    {isLive && <BroadcastSyncControl />}
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-gray-800 bg-gray-900">
                        <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                        <span className="text-[10px] uppercase tracking-widest font-bold text-gray-400">
                            {connected ? 'Streaming' : 'Disconnected'}
                        </span>
                    </div>
                </div>
            </div>

            {!isLive ? (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center text-gray-500">
                    The realtime tracker is available on the live session.
                </div>
            ) : (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 md:p-6">
                    <LiveTrackMap tracker={liveRace?.tracker} />
                </div>
            )}
        </div>
    );
};
