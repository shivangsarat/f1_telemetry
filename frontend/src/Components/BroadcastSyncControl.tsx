import { useRaceStore } from '../store/useRaceStore';

export const BroadcastSyncControl = () => {
    const connected = useRaceStore(state => state.connected);
    const seconds = useRaceStore(state => state.broadcastDelaySeconds);
    const setSeconds = useRaceStore(state => state.setBroadcastDelaySeconds);

    const update = (next: number) => setSeconds(Math.max(0, Math.min(120, next)));

    return (
        <div
            className="bg-gray-900 border border-gray-700 rounded-full shadow-lg flex items-center gap-1.5 px-2 py-1"
            title="Delay the displayed live data to match your TV/stream broadcast. The backend continues processing realtime data immediately."
        >
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-[9px] font-black uppercase tracking-widest text-gray-400 px-1">
                Broadcast Sync
            </span>

            <button
                type="button"
                onClick={() => update(seconds - 5)}
                disabled={seconds <= 0}
                className="w-7 h-7 rounded-full border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 disabled:opacity-30 disabled:cursor-not-allowed font-black"
                aria-label="Decrease broadcast delay by 5 seconds"
            >
                −
            </button>

            <div className="flex items-center gap-1 bg-black/30 border border-gray-800 rounded-md px-2 h-7">
                <input
                    type="number"
                    min={0}
                    max={120}
                    step={1}
                    value={seconds}
                    onChange={event => update(Number(event.target.value))}
                    className="w-10 bg-transparent text-center font-mono text-xs font-black text-white outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    aria-label="Broadcast delay seconds"
                />
                <span className="text-[9px] font-bold text-gray-500">s</span>
            </div>

            <button
                type="button"
                onClick={() => update(seconds + 5)}
                disabled={seconds >= 120}
                className="w-7 h-7 rounded-full border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 disabled:opacity-30 disabled:cursor-not-allowed font-black"
                aria-label="Increase broadcast delay by 5 seconds"
            >
                +
            </button>

            {seconds > 0 ? (
                <button
                    type="button"
                    onClick={() => update(0)}
                    className="ml-1 px-2 h-7 rounded-md border border-blue-500/30 bg-blue-500/10 text-[9px] font-black uppercase tracking-wider text-blue-300 hover:bg-blue-500/20"
                >
                    Realtime
                </button>
            ) : (
                <span className="ml-1 px-2 text-[9px] font-black uppercase tracking-wider text-green-400">
                    Live
                </span>
            )}
        </div>
    );
};
