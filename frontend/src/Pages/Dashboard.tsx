import { useEffect, useState, useMemo } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Table } from '../Utils/Table';
import { useRaceStore } from '../store/useRaceStore';
import { WeatherCard, SessionBestsCard, RaceControlWidget, DriverExpandedRow } from '../Components/DashboardWidgets';
import { getTyreColor } from '../Utils/helpers';

export const Dashboard = () => {
    const { sessionKey } = useParams();
    const navigate = useNavigate();

    const effectiveSessionKey = sessionKey === 'live' ? 'latest' : sessionKey;
    const isLive = effectiveSessionKey === 'live';
    
    const [histData, setHistData] = useState<any>({ results: [], weather: null, sessionBests: null, isRace: true, maxRaceLap: 0, availableSessions: [], loading: !isLive });
    const [histRaceControl, setHistRaceControl] = useState<any[]>([]);
    const [latestToast, setLatestToast] = useState<any>(null);

    const { intervals: liveResults, weather: liveWeather, sessionBests: liveBests, isRace: liveIsRace, maxRaceLap: liveMaxLap, raceControl: liveRc, connect } = useRaceStore();

    useEffect(() => {
        setHistData({ results: [], weather: null, sessionBests: null, isRace: true, maxRaceLap: 0, availableSessions: [], loading: !isLive });
        
        const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:8080';

        if (isLive) {
            connect();
        } else {
            Promise.all([
                fetch(`${API_BASE}/api/race-details/${effectiveSessionKey}`).then(r => r.json()),
                fetch(`${API_BASE}/api/race-control/${effectiveSessionKey}`).then(r => r.json())
            ]).then(([data, rcData]) => {
                if (data.active_session_key && String(data.active_session_key) !== String(effectiveSessionKey)) {
                    navigate(`/race/${data.active_session_key}`, { replace: true });
                    return;
                }
                setHistData({ ...data, loading: false });
                setHistRaceControl(rcData);
            }).catch(() => setHistData((prev: any) => ({ ...prev, loading: false })));
        }
    }, [isLive, effectiveSessionKey, connect, navigate]);

    const activeResults = isLive ? liveResults : histData.results;
    const activeWeather = isLive ? liveWeather : histData.weather;
    const activeBests = isLive && liveBests ? liveBests : histData.sessionBests;
    const isRaceMode = isLive ? liveIsRace : histData.isRace;
    const activeMaxLap = isLive ? liveMaxLap : histData.maxRaceLap;
    const activeRaceControl = isLive ? liveRc : histRaceControl;

    console.log('activeResults', activeResults);

    console.log('activeRaceControl', activeRaceControl);

    useEffect(() => {
        if (isLive && activeRaceControl.length > 0) {
            const newest = activeRaceControl[0];
            if (!latestToast || newest.date !== latestToast.date) {
                setLatestToast(newest);
                const t = setTimeout(() => setLatestToast(null), 8000);
                return () => clearTimeout(t);
            }
        }
    }, [activeRaceControl, isLive, latestToast]);

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
                        {isRetired && <span className="bg-red-900/30 text-red-500 text-[9px] px-1.5 py-0.5 rounded font-black uppercase tracking-widest border border-red-800/50 shadow-sm ml-2">{row.status}</span>}
                    </div>
                );
            } 
        },
        { header: 'Laps', accessor: (row: any) => <span className={`font-mono ${row.status === 'DNF' || row.status === 'DNS' ? 'text-gray-500' : 'text-gray-300'}`}>{row.driver_laps}</span> },
        { header: isRaceMode ? 'Interval' : 'Best Lap', accessor: (row: any) => <span className={`font-mono ${row.status === 'DNF' || row.status === 'DNS' ? 'text-gray-500' : 'text-gray-300'}`}>{isRaceMode ? row.interval : row.best_lap}</span> },
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
            {latestToast && (
                <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] bg-red-600 text-white px-6 py-3 rounded-full shadow-2xl font-bold uppercase tracking-wider animate-bounce flex items-center gap-3 border border-red-400">
                    ⚠️ {latestToast.message}
                </div>
            )}

            <RaceControlWidget messages={activeRaceControl} />

            <div className="flex-1 flex flex-col gap-6 overflow-y-auto relative z-10">
                <div className="flex justify-between items-center">
                    
                    <div className="flex items-center gap-6">
                        <Link to="/" className="text-gray-400 hover:text-white uppercase tracking-widest text-sm font-bold">← Back</Link>
                        
                        <div className="flex gap-2 bg-gray-900/50 p-1 rounded-lg">
                            {histData.availableSessions.map((s: any) => {
                                const isFuture = new Date(s.date_start).getTime() > Date.now();
                                const isActive = sessionKey === String(s.session_key);

                                return (
                                    <button
                                        key={s.session_key}
                                        onClick={() => navigate(`/race/${s.session_key}`)}
                                        disabled={isFuture}
                                        className={`px-4 py-2 text-xs font-bold tracking-widest rounded-md transition-all ${
                                            isActive 
                                                ? 'bg-red-600 text-white shadow-lg' 
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

                    {isRaceMode && activeMaxLap > 0 && (
                        <div className="bg-gray-900 border border-gray-700 px-4 py-1.5 rounded-full shadow-lg flex items-center gap-3">
                            <div className={`w-2 h-2 rounded-full ${isLive ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`}></div>
                            <span className="font-bold uppercase tracking-widest text-xs text-gray-400">Total Laps</span>
                            <span className="font-black text-white font-mono text-sm">{activeMaxLap}</span>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <WeatherCard weather={activeWeather} />
                    <SessionBestsCard bests={activeBests} />
                </div>

                <div className="bg-gray-900 rounded-xl border border-gray-800 flex-1 flex flex-col overflow-hidden shadow-2xl">
                    <div className="overflow-y-auto flex-1 custom-scrollbar relative">
                        {histData.loading ? (
                            <div className="p-10 text-center text-gray-500 animate-pulse">Fetching Session Data...</div>
                        ) : (
                            <Table 
                                data={activeResults || []} 
                                columns={driverColumns} 
                                getRowKey={(row: any) => row.driver_number}
                                expandableRender={(row) => <DriverExpandedRow driver={row} isLive={isLive} isRaceMode={isRaceMode} />}
                            />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};