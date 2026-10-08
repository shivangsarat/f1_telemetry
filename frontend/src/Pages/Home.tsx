import { Fragment, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Table } from '../Utils/Table';
import { useRaceStore } from '../store/useRaceStore';

const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:8080';

export const Home = () => {
    const cachedHomeData = useRaceStore(state => state.homeData);
    const cachedSelectedSeason = useRaceStore(state => state.selectedSeason);
    const seasonRaceCache = useRaceStore(state => state.seasonRaces);
    const cacheHomeData = useRaceStore(state => state.cacheHomeData);
    const cacheSeasonRaces = useRaceStore(state => state.cacheSeasonRaces);
    const persistSelectedSeason = useRaceStore(state => state.setSelectedSeason);

    const initialSeason = cachedSelectedSeason
        ?? Number(cachedHomeData?.seasonMeta?.currentSeason || new Date().getFullYear());

    const [data, setData] = useState<any>(() => cachedHomeData);
    const [selectedSeason, setSelectedSeason] = useState<number | null>(() => initialSeason);
    const [seasonRaces, setSeasonRaces] = useState<any[]>(() =>
        seasonRaceCache[initialSeason] || cachedHomeData?.pastRaces || []
    );
    const [seasonLoading, setSeasonLoading] = useState(false);
    const [seasonError, setSeasonError] = useState('');
    const navigate = useNavigate();

    useEffect(() => {
        const state = useRaceStore.getState();
        const cached = state.homeData;
        const cacheAge = Date.now() - state.homeDataUpdatedAt;

        if (cached) {
            setData(cached);
            const currentSeason = Number(cached?.seasonMeta?.currentSeason || new Date().getFullYear());
            const restoredSeason = state.selectedSeason ?? currentSeason;
            setSelectedSeason(restoredSeason);
            setSeasonRaces(state.seasonRaces[restoredSeason] || (restoredSeason === currentSeason ? cached.pastRaces || [] : []));
        }

        // Keep current/live home metadata fresh, but never blank the page while it
        // refreshes. A quick route return within 30 seconds performs no request.
        if (cached && cacheAge < 30000) return;

        fetch(`${API_BASE}/api/home`)
            .then(r => {
                if (!r.ok) throw new Error('Failed to load dashboard');
                return r.json();
            })
            .then(payload => {
                cacheHomeData(payload);
                setData(payload);

                const currentSeason = Number(payload?.seasonMeta?.currentSeason || new Date().getFullYear());
                const restoredSeason = useRaceStore.getState().selectedSeason ?? currentSeason;
                if (useRaceStore.getState().selectedSeason == null) {
                    persistSelectedSeason(currentSeason);
                    setSelectedSeason(currentSeason);
                }

                cacheSeasonRaces(currentSeason, payload?.pastRaces || []);
                if (restoredSeason === currentSeason) {
                    setSeasonRaces(payload?.pastRaces || []);
                }
            })
            .catch(() => {
                if (!cached) setSeasonError('Unable to load dashboard data.');
            });
    }, [cacheHomeData, cacheSeasonRaces, persistSelectedSeason]);

    const changeSeason = async (year: number) => {
        if (!Number.isInteger(year) || year === selectedSeason) return;

        setSelectedSeason(year);
        persistSelectedSeason(year);
        setSeasonError('');

        const cached = useRaceStore.getState().seasonRaces[year];
        if (cached) {
            setSeasonRaces(cached);
            setSeasonLoading(false);
            return;
        }

        setSeasonLoading(true);

        try {
            const response = await fetch(`${API_BASE}/api/seasons/${year}/races`);
            if (!response.ok) throw new Error('Failed to load season');
            const payload = await response.json();
            const races = payload.races || [];
            cacheSeasonRaces(year, races);
            setSeasonRaces(races);
        } catch {
            setSeasonRaces([]);
            setSeasonError(`Unable to load ${year} season races.`);
        } finally {
            setSeasonLoading(false);
        }
    };

    const driverColumns = [
        { header: 'Pos', accessor: 'position', width: '12%' },
        { header: 'Driver', accessor: 'name', width: '29%' },
        { header: 'Team', accessor: 'team', width: '27%' },
        { header: 'Points', accessor: 'points', width: '16%' },
        { 
            header: 'To Next',
            width: '16%', 
            accessor: (row: any) => (
                <span className={`font-mono ${row.diff_to_next === '-' ? 'text-gray-500' : 'text-red-400'}`}>
                    {row.diff_to_next}
                </span>
            ) 
        }
    ];

    const teamColumns = [
        { header: 'Pos', accessor: 'position', width: '12%' },
        { header: 'Team', accessor: 'name', width: '42%' },
        { header: 'Points', accessor: 'points', width: '20%' },
        { 
            header: 'To Next',
            width: '26%', 
            accessor: (row: any) => (
                <span className={`font-mono ${row.diff_to_next === '-' ? 'text-gray-500' : 'text-red-400'}`}>
                    {row.diff_to_next}
                </span>
            ) 
        }
    ];

    const pastRaceColumns = [
        { 
            header: 'Round',
            width: '66%', 
            accessor: (row: any) => (
                <Link to={`/race/${row.session_key}`} className="text-blue-400 hover:text-blue-300 hover:underline font-bold transition">
                    {row.round}
                </Link>
            ) 
        },
        { header: 'Date', accessor: (row: any) => new Date(row.date).toLocaleDateString(), width: '34%' }
    ];

    const upcomingRaceColumns = [
        { header: 'Round', accessor: 'round', width: '66%' },
        { header: 'Date', accessor: (row: any) => new Date(row.date).toLocaleDateString(), width: '34%' }
    ];

    if (!data) return <div className="p-10 text-white animate-pulse">Loading Dashboard...</div>;

    return (
        <div className="min-h-screen bg-black text-white p-6 flex flex-col gap-6">
            <div className="flex justify-between items-center bg-gray-900 p-4 rounded-xl border border-gray-800">
                <h1 className="text-2xl font-bold uppercase tracking-wider text-red-500">F1 Dashboard</h1>
                <button 
                    // onClick={() => navigate(`/race/${data.liveStatus.session_key}`)}
                    onClick={() => navigate(`/race/live`)}
                    disabled={!data.liveStatus.isLive}
                    className={`px-6 py-2 rounded font-bold uppercase tracking-widest transition ${
                        data.liveStatus.isLive ? 'bg-red-600 hover:bg-red-500 text-white animate-pulse' : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                    }`}
                >
                    {data.liveStatus.isLive ? 'Live Session Active' : 'No Live Session'}
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                {/* 
                    FIX: Changed wrapper to flex-col and moved overflow to an inner div. 
                    This ensures the padding is NOT part of the scroll area, preventing the transparent gap above the sticky header.
                */}
                <div className="bg-gray-900 rounded-xl border border-gray-800 h-[800px] flex flex-col overflow-hidden shadow-xl">
                    <div className="p-5 pb-0">
                        <h2 className="font-bold uppercase tracking-wider text-gray-400 mb-4">Driver Standings</h2>
                    </div>
                    <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar px-5 pt-2 pb-5">
                        <Table data={data.drivers} columns={driverColumns} fit />
                    </div>
                </div>

                <div className="bg-gray-900 rounded-xl border border-gray-800 h-[800px] flex flex-col overflow-hidden shadow-xl">
                    <div className="p-5 pb-0">
                        <h2 className="font-bold uppercase tracking-wider text-gray-400 mb-4">Constructor Standings</h2>
                    </div>
                    <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar px-5 pt-2 pb-5">
                        <Table data={data.teams} columns={teamColumns} fit />
                    </div>
                </div>

                <div className="bg-gray-900 rounded-xl border border-gray-800 h-[800px] flex flex-col overflow-hidden shadow-xl">
                    <div className="p-5 pb-0">
                        <div className="flex items-center justify-between gap-3 mb-4">
                            <div>
                                <h2 className="font-bold uppercase tracking-wider text-gray-400">Past Races</h2>
                                {data.seasonMeta?.oldestSeason && (
                                    <span className="text-[9px] uppercase tracking-widest text-gray-600">
                                        OpenF1 archive from {data.seasonMeta.oldestSeason}
                                    </span>
                                )}
                            </div>

                            <div className="flex items-center gap-2">
                                {selectedSeason !== Number(data.seasonMeta?.currentSeason || new Date().getFullYear()) && (
                                    <button
                                        type="button"
                                        onClick={() => changeSeason(Number(data.seasonMeta?.currentSeason || new Date().getFullYear()))}
                                        disabled={seasonLoading}
                                        className="px-2.5 py-2 rounded-md border border-blue-500/40 bg-blue-500/10 text-[9px] font-black uppercase tracking-widest text-blue-300 hover:bg-blue-500/20 hover:border-blue-400 disabled:opacity-50 transition"
                                        title="Jump back to the current season"
                                    >
                                        Current Season
                                    </button>
                                )}

                                <select
                                    value={selectedSeason ?? ''}
                                    onChange={event => changeSeason(Number(event.target.value))}
                                    disabled={seasonLoading}
                                    className="bg-gray-950 border border-gray-700 rounded-md px-3 py-2 text-xs font-bold text-gray-200 outline-none focus:border-blue-500 disabled:opacity-50"
                                    aria-label="Select Formula 1 season"
                                >
                                    {(data.seasonMeta?.availableSeasons || []).map((year: number) => (
                                        <option key={year} value={year}>{year}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar px-5 pt-2 pb-5">
                        {seasonLoading ? (
                            <div className="py-10 text-center text-xs uppercase tracking-widest font-bold text-gray-500 animate-pulse">
                                Loading {selectedSeason} season…
                            </div>
                        ) : seasonError ? (
                            <div className="py-6 text-center text-xs text-red-400">{seasonError}</div>
                        ) : seasonRaces.length > 0 ? (
                            <Table data={seasonRaces} columns={pastRaceColumns} fit />
                        ) : (
                            <div className="py-10 text-center text-xs uppercase tracking-widest font-bold text-gray-600">
                                No completed races available for {selectedSeason}
                            </div>
                        )}
                    </div>
                </div>

                <div className="bg-gray-900 rounded-xl border border-gray-800 h-[800px] flex flex-col overflow-hidden shadow-xl">
                    <div className="p-5 pb-0">
                        <h2 className="font-bold uppercase tracking-wider text-gray-400 mb-4">Upcoming Races</h2>
                    </div>
                    <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar px-5 pt-2 pb-5">
                        <div className="w-full relative">
                            <table className="w-full table-fixed border-separate border-spacing-0 text-sm text-left">
                                <thead>
                                    <tr>
                                        {upcomingRaceColumns.map((col, idx) => (
                                            <th
                                                key={idx}
                                                className="sticky top-0 z-50 px-2 py-3 bg-gray-900 font-bold uppercase tracking-wider text-xs border-b border-gray-700 shadow-sm break-words"
                                                style={col.width ? { width: col.width } : undefined}
                                            >
                                                {col.header}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-800/50">
                                    {(data.upcomingRaces || []).map((race: any, index: number) => {
                                        const raceYear = Number(race.year || new Date(race.date).getFullYear());
                                        const previousYear = index > 0
                                            ? Number(data.upcomingRaces[index - 1]?.year || new Date(data.upcomingRaces[index - 1]?.date).getFullYear())
                                            : null;
                                        const showSeasonDivider = previousYear !== null && raceYear !== previousYear;

                                        return (
                                            <Fragment key={race.session_key || `${raceYear}-${race.round}-${race.date}`}>
                                                {showSeasonDivider && (
                                                    <tr>
                                                        <td colSpan={2} className="px-4 py-3 bg-gray-950/80 border-y border-blue-500/20">
                                                            <div className="flex items-center gap-3">
                                                                <span className="h-px flex-1 bg-gray-800" />
                                                                <span className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-400 whitespace-nowrap">
                                                                    {raceYear} Season
                                                                </span>
                                                                <span className="h-px flex-1 bg-gray-800" />
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                                <tr className="group transition-colors hover:bg-gray-800/30">
                                                    <td className="px-2 py-4 break-words whitespace-normal" style={{ width: '66%' }}>
                                                        <Link
                                                            to={`/race/${race.session_key}`}
                                                            className="text-blue-400 hover:text-blue-300 hover:underline font-bold transition"
                                                        >
                                                            {race.round}
                                                        </Link>
                                                    </td>
                                                    <td className="px-2 py-4 break-words whitespace-normal" style={{ width: '34%' }}>{new Date(race.date).toLocaleDateString()}</td>
                                                </tr>
                                            </Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};