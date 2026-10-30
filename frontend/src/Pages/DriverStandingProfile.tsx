import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:8080';

const statCard = (label: string, value: any, accent = '') => (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500 mb-2">{label}</div>
        <div className={`text-2xl font-black font-mono ${accent || 'text-white'}`}>{value ?? '-'}</div>
    </div>
);

export const DriverStandingProfile = () => {
    const { driverId } = useParams();
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!driverId) return;
        setLoading(true);
        fetch(`${API_BASE}/api/profiles/driver/${driverId}`)
            .then(response => {
                if (!response.ok) throw new Error('Failed to load driver profile');
                return response.json();
            })
            .then(setData)
            .finally(() => setLoading(false));
    }, [driverId]);

    const summary = useMemo(() => {
        const races = data?.races || [];
        const podiums = races.filter((race: any) => Number(race.position) >= 1 && Number(race.position) <= 3).length;
        const dnfs = races.filter((race: any) => !/^Finished|^\+\d+ Lap/i.test(String(race.status || ''))).length;
        const points = races.reduce((sum: number, race: any) => sum + Number(race.points || 0), 0);
        const bestFinish = races.reduce((best: number | null, race: any) => {
            const position = Number(race.position);
            return Number.isFinite(position) && position > 0 ? (best === null ? position : Math.min(best, position)) : best;
        }, null);
        return { podiums, dnfs, points, bestFinish };
    }, [data]);

    if (loading) {
        return <div className="min-h-screen bg-black text-gray-400 p-8 font-bold uppercase tracking-widest animate-pulse">Loading Driver Profile...</div>;
    }

    if (!data?.driver) {
        return <div className="min-h-screen bg-black text-white p-8">Driver profile unavailable.</div>;
    }

    return (
        <div className="min-h-screen bg-black text-white p-6 md:p-8">
            <div className="max-w-7xl mx-auto flex flex-col gap-6">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <Link to="/" className="text-xs font-bold uppercase tracking-widest text-gray-500 hover:text-white">← Back</Link>
                        <div className="mt-4 flex items-baseline gap-3 flex-wrap">
                            <h1 className="text-4xl font-black uppercase tracking-tight">{data.driver.name}</h1>
                            {data.driver.permanent_number && (
                                <span className="text-2xl font-black font-mono text-gray-500">#{data.driver.permanent_number}</span>
                            )}
                        </div>
                        <div className="mt-2 text-sm text-gray-400">
                            {data.driver.nationality || '-'} · {data.team?.name || 'No current constructor'}
                        </div>
                    </div>

                    <div className="rounded-full border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-xs font-black uppercase tracking-widest text-blue-300">
                        {data.season} Season
                    </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4">
                    {statCard('Championship', data.standing?.position ? `P${data.standing.position}` : '-')}
                    {statCard('Points', data.standing?.points ?? summary.points, 'text-blue-300')}
                    {statCard('Wins', data.standing?.wins ?? 0, 'text-amber-300')}
                    {statCard('Podiums', summary.podiums)}
                    {statCard('Best Finish', summary.bestFinish ? `P${summary.bestFinish}` : '-')}
                    {statCard('Races', data.races?.length || 0)}
                    {statCard('DNF / NC', summary.dnfs, summary.dnfs > 0 ? 'text-red-300' : '')}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-1 rounded-xl border border-gray-800 bg-gray-900 p-6">
                        <h2 className="text-sm font-black uppercase tracking-widest text-gray-300 mb-5">Driver Info</h2>
                        <div className="space-y-4 text-sm">
                            <div className="flex justify-between gap-4 border-b border-gray-800 pb-3">
                                <span className="text-gray-500">Code</span><span className="font-bold">{data.driver.code || '-'}</span>
                            </div>
                            <div className="flex justify-between gap-4 border-b border-gray-800 pb-3">
                                <span className="text-gray-500">Nationality</span><span className="font-bold">{data.driver.nationality || '-'}</span>
                            </div>
                            <div className="flex justify-between gap-4 border-b border-gray-800 pb-3">
                                <span className="text-gray-500">Date of birth</span>
                                <span className="font-bold">{data.driver.date_of_birth ? new Date(data.driver.date_of_birth).toLocaleDateString() : '-'}</span>
                            </div>
                            <div className="flex justify-between gap-4">
                                <span className="text-gray-500">Constructor</span>
                                {data.team?.id ? (
                                    <Link to={`/team/${data.team.id}`} className="font-bold text-blue-400 hover:underline">{data.team.name}</Link>
                                ) : <span className="font-bold">-</span>}
                            </div>
                        </div>
                    </div>

                    <div className="lg:col-span-2 rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
                        <div className="px-6 py-5 border-b border-gray-800">
                            <h2 className="text-sm font-black uppercase tracking-widest text-gray-300">Season Results</h2>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="text-[10px] uppercase tracking-widest text-gray-500">
                                    <tr className="border-b border-gray-800">
                                        <th className="px-5 py-3">Round</th>
                                        <th className="px-5 py-3">Race</th>
                                        <th className="px-5 py-3">Grid</th>
                                        <th className="px-5 py-3">Finish</th>
                                        <th className="px-5 py-3">Pts</th>
                                        <th className="px-5 py-3">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(data.races || []).map((race: any) => (
                                        <tr key={`${race.round}-${race.race_name}`} className="border-b border-gray-800/60 hover:bg-gray-800/30">
                                            <td className="px-5 py-4 font-mono text-gray-500">{race.round}</td>
                                            <td className="px-5 py-4 font-bold">{race.race_name}</td>
                                            <td className="px-5 py-4 font-mono">P{race.grid}</td>
                                            <td className="px-5 py-4 font-mono font-bold">P{race.position}</td>
                                            <td className="px-5 py-4 font-mono text-blue-300">{race.points}</td>
                                            <td className="px-5 py-4 text-gray-400">{race.status}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
