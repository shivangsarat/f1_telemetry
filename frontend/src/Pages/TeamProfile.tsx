import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:8080';

export const TeamProfile = () => {
    const { teamId } = useParams();
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!teamId) return;
        setLoading(true);
        fetch(`${API_BASE}/api/profiles/team/${teamId}`)
            .then(response => {
                if (!response.ok) throw new Error('Failed to load team profile');
                return response.json();
            })
            .then(setData)
            .finally(() => setLoading(false));
    }, [teamId]);

    const summary = useMemo(() => {
        const raceResults = (data?.races || []).flatMap((race: any) => race.results || []);
        return {
            podiums: raceResults.filter((result: any) => Number(result.position) >= 1 && Number(result.position) <= 3).length,
            points: raceResults.reduce((sum: number, result: any) => sum + Number(result.points || 0), 0),
            bestFinish: raceResults.reduce((best: number | null, result: any) => {
                const position = Number(result.position);
                return Number.isFinite(position) && position > 0 ? (best === null ? position : Math.min(best, position)) : best;
            }, null)
        };
    }, [data]);

    if (loading) {
        return <div className="min-h-screen bg-black text-gray-400 p-8 font-bold uppercase tracking-widest animate-pulse">Loading Team Profile...</div>;
    }

    if (!data?.team) {
        return <div className="min-h-screen bg-black text-white p-8">Team profile unavailable.</div>;
    }

    return (
        <div className="min-h-screen bg-black text-white p-6 md:p-8">
            <div className="max-w-7xl mx-auto flex flex-col gap-6">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <Link to="/" className="text-xs font-bold uppercase tracking-widest text-gray-500 hover:text-white">← Back</Link>
                        <h1 className="mt-4 text-4xl font-black uppercase tracking-tight">{data.team.name}</h1>
                        <div className="mt-2 text-sm text-gray-400">{data.team.nationality || '-'}</div>
                    </div>
                    <div className="rounded-full border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-black uppercase tracking-widest text-red-300">
                        {data.season} Constructors
                    </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    {[
                        ['Championship', data.standing?.position ? `P${data.standing.position}` : '-'],
                        ['Points', data.standing?.points ?? summary.points],
                        ['Wins', data.standing?.wins ?? 0],
                        ['Podiums', summary.podiums],
                        ['Best Finish', summary.bestFinish ? `P${summary.bestFinish}` : '-']
                    ].map(([label, value]) => (
                        <div key={String(label)} className="rounded-xl border border-gray-800 bg-gray-900 p-5">
                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500 mb-2">{label}</div>
                            <div className="text-2xl font-black font-mono text-white">{value}</div>
                        </div>
                    ))}
                </div>

                <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
                    <h2 className="text-sm font-black uppercase tracking-widest text-gray-300 mb-5">Drivers</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {(data.drivers || []).map((driver: any) => (
                            <Link
                                key={driver.id}
                                to={`/driver/${driver.id}`}
                                className="rounded-lg border border-gray-800 bg-gray-950/40 p-4 hover:border-blue-500/40 hover:bg-blue-500/5 transition"
                            >
                                <div className="flex items-center justify-between gap-4">
                                    <div>
                                        <div className="font-black text-white">{driver.name}</div>
                                        <div className="text-xs text-gray-500 mt-1">{driver.nationality || '-'}</div>
                                    </div>
                                    {driver.permanent_number && (
                                        <div className="font-mono text-2xl font-black text-gray-500">#{driver.permanent_number}</div>
                                    )}
                                </div>
                            </Link>
                        ))}
                    </div>
                </div>

                <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
                    <div className="px-6 py-5 border-b border-gray-800">
                        <h2 className="text-sm font-black uppercase tracking-widest text-gray-300">Season Results</h2>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="text-[10px] uppercase tracking-widest text-gray-500">
                                <tr className="border-b border-gray-800">
                                    <th className="px-5 py-3">Round</th>
                                    <th className="px-5 py-3">Race</th>
                                    <th className="px-5 py-3">Driver</th>
                                    <th className="px-5 py-3">Grid</th>
                                    <th className="px-5 py-3">Finish</th>
                                    <th className="px-5 py-3">Pts</th>
                                    <th className="px-5 py-3">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(data.races || []).flatMap((race: any) =>
                                    (race.results || []).map((result: any) => (
                                        <tr key={`${race.round}-${result.driver_id}`} className="border-b border-gray-800/60 hover:bg-gray-800/30">
                                            <td className="px-5 py-4 font-mono text-gray-500">{race.round}</td>
                                            <td className="px-5 py-4 font-bold">{race.race_name}</td>
                                            <td className="px-5 py-4">
                                                <Link to={`/driver/${result.driver_id}`} className="text-blue-400 hover:underline font-bold">
                                                    {result.driver_name}
                                                </Link>
                                            </td>
                                            <td className="px-5 py-4 font-mono">P{result.grid}</td>
                                            <td className="px-5 py-4 font-mono font-bold">P{result.position}</td>
                                            <td className="px-5 py-4 font-mono text-blue-300">{result.points}</td>
                                            <td className="px-5 py-4 text-gray-400">{result.status}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};
