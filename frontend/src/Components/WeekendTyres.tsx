import { useEffect, useState } from 'react';

type SetHistory = { session: string; stint: number; laps: number; startAge: number | null; endAge: number | null; alternatives: string[]; reason: string };
type TyreSet = { id: string; compound: string; age: number | null; inferred: boolean; extra?: boolean; history: SetHistory[] };
type Inventory = { sets: TyreSet[]; allocationLabel: string; availability: string; incomplete?: boolean };
const colours: Record<string, string> = { HARD: 'text-gray-100', MEDIUM: 'text-yellow-300', SOFT: 'text-red-400', INTERMEDIATE: 'text-green-400', WET: 'text-blue-400' };

export const WeekendTyres = ({ sessionKey, driverNumber, isLive, delaySeconds }: {
    sessionKey?: string | number; driverNumber: number; isLive: boolean; delaySeconds: number;
}) => {
    const [data, setData] = useState<Inventory | null>(null);
    const [error, setError] = useState(false);
    const [selected, setSelected] = useState<string | null>(null);
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        setData(null); setError(false); setSelected(null);
        if (!sessionKey) return;
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout>;
        const load = async () => {
            try {
                const base = import.meta.env.PROD ? '' : 'http://localhost:8080';
                const cutoff = Date.now() - (isLive ? delaySeconds * 1000 : 0);
                const response = await fetch(`${base}/api/weekend-tyres/${sessionKey}/${driverNumber}?asOf=${cutoff}`, { signal: controller.signal });
                if (!response.ok) throw new Error('Unavailable');
                const result = await response.json();
                if (!controller.signal.aborted) { setData(result); setError(false); }
            } catch {
                if (!controller.signal.aborted) setError(true);
            } finally {
                if (isLive && !controller.signal.aborted) timer = setTimeout(load, 15000);
            }
        };
        void load();
        return () => { controller.abort(); clearTimeout(timer); };
    }, [sessionKey, driverNumber, isLive, delaySeconds, retry]);
    const detail = data?.sets.find(s => s.id === selected);
    return <section className="bg-gray-900 p-5 rounded-xl border border-gray-800 shadow-lg min-w-0" aria-label="Weekend tyre sets">
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-300 mb-3">Weekend tyre sets</h2>
        {error && <div role="status" className="text-xs text-amber-300 mb-3">{data ? 'Update unavailable · showing previous snapshot' : 'Weekend tyre history unavailable'} <button className="underline ml-2" onClick={() => setRetry(n => n + 1)}>Retry</button></div>}
        {!data && !error && <p className="text-xs text-gray-400">{sessionKey ? 'Loading weekend history…' : 'Waiting for session…'}</p>}
        {data && <>
            <div className="divide-y divide-gray-800">
                {[...new Set(data.sets.map(s => s.compound))].map(compound => <div key={compound} className="grid grid-cols-[80px_minmax(0,1fr)] gap-3 py-3 items-start">
                    <span className={`text-xs font-bold capitalize pt-2 ${colours[compound] || 'text-gray-300'}`}>{compound.toLowerCase()}</span>
                    <div className="flex flex-wrap gap-2">{data.sets.filter(s => s.compound === compound).map(set => <button key={set.id} type="button" aria-expanded={selected === set.id} aria-controls="weekend-tyre-detail" onClick={() => setSelected(selected === set.id ? null : set.id)} className={`px-3 py-2 rounded border text-xs font-mono whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 ${selected === set.id ? 'border-blue-400 bg-blue-500/10 text-white' : 'border-gray-700 text-gray-300 hover:bg-gray-800'}`}>
                        {set.id} · {set.age === null ? '—' : `${set.inferred ? '≈' : ''}${set.age}L`}
                    </button>)}</div>
                </div>)}
            </div>
            <div id="weekend-tyre-detail" aria-live="polite">{detail && <div className="mt-3 p-3 rounded-lg bg-gray-950/50 border border-gray-700 text-xs text-gray-300">
                <div className="flex justify-between gap-3 mb-2"><strong>{detail.id} · {detail.compound.toLowerCase()}</strong><button aria-label="Close tyre set details" onClick={() => setSelected(null)}>×</button></div>
                <p className="text-gray-400 mb-2">{detail.history.length ? 'Observed usage · set identity inferred' : 'Not observed · age unknown'}. Availability unverified.</p>
                {detail.extra && <p className="text-amber-300 mb-2">Unmatched observation; outside assumed allocation.</p>}
                {detail.history.map((run, i) => <div key={i} className="border-t border-gray-800 py-2">
                    <div className="flex justify-between gap-2 flex-wrap"><span>{run.session} · stint {run.stint}</span><span>{run.startAge ?? '—'} → {run.endAge ?? '—'} laps (+{run.laps} observed)</span></div>
                    <p className="text-gray-400 mt-1">{run.reason}{run.alternatives.length ? ` · Also matches: ${run.alternatives.join(', ')}` : ''}</p>
                </div>)}
            </div>}</div>
            <p className="text-[11px] text-gray-400 mt-3">≈ inferred age assignment · — unknown age</p>
            <p className="text-[11px] text-gray-500 mt-1">{data.allocationLabel}. Returns unverified. Wet sets shown when observed.</p>
            {data.incomplete && <p className="text-xs text-amber-300 mt-2">Some stint timestamps are missing; history is incomplete.</p>}
        </>}
    </section>;
};
