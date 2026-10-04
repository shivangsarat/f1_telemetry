import { useEffect, useState, useMemo, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Table } from '../Utils/Table';
import { useRaceStore } from '../store/useRaceStore';
import { WeatherCard, SessionBestsCard, RaceControlWidget, DriverExpandedRow } from '../Components/DashboardWidgets';
import { getTyreColor } from '../Utils/helpers';

export const Dashboard = () => {
    const { sessionKey } = useParams();
    const navigate = useNavigate();

    // Use a state flag to track if this specific session is currently live
    const [isLiveSession, setIsLiveSession] = useState(sessionKey === 'live');
    
    const [histData, setHistData] = useState<any>({ results: [], weather: null, sessionBests: null, isRace: true, maxRaceLap: 0, availableSessions: [], loading: true });
    const [histRaceControl, setHistRaceControl] = useState<any[]>([]);
    const [latestToast, setLatestToast] = useState<any>(null);
    const hasConnected = useRef(false);

    const { intervals: liveResults, weather: liveWeather, sessionBests: liveBests, isRace: liveIsRace, maxRaceLap: liveMaxLap, raceControl: liveRc, connect } = useRaceStore();

    useEffect(() => {
        setHistData({ results: [], weather: null, sessionBests: null, isRace: true, maxRaceLap: 0, availableSessions: [], loading: true });
        
        // Reset connection tracker if we navigate to a new page
        hasConnected.current = false; 

        const effectiveKey = sessionKey === 'live' ? 'latest' : sessionKey;
        const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:8080';

        Promise.all([
            fetch(`${API_BASE}/api/race-details/${effectiveKey}`).then(r => r.json()),
            fetch(`${API_BASE}/api/race-control/${effectiveKey}`).then(r => r.json())
        ]).then(([data, rcData]) => {
            
            const activeKey = data.active_session_key ? String(data.active_session_key) : null;
            
            // Determine if the session we just loaded is currently live on the track
            const isCurrentlyLive = sessionKey === 'live' || (activeKey && activeKey === String(sessionKey)) as boolean;
            setIsLiveSession(isCurrentlyLive);

            // Connect WebSocket if it's a live session
            if (isCurrentlyLive && !hasConnected.current) {
                connect();
                hasConnected.current = true;
            }

            setHistData({ ...data, loading: false });
            setHistRaceControl(rcData);
        }).catch(() => setHistData((prev: any) => ({ ...prev, loading: false })));
    }, [sessionKey, connect]);

    // --- SMART MERGE: Combine Rich Historical Data with Live Telemetry Updates ---
    const activeResults = useMemo(() => {
        if (!isLiveSession || !liveResults || liveResults.length === 0) {
            return histData.results || [];
        }
        
        // Map over the rich base data and overlay the live dynamic fields
        return (histData.results || []).map((histDriver: any) => {
            const liveDriver = liveResults.find((d: any) => String(d.driver_number) === String(histDriver.driver_number));
            if (liveDriver) {
                return {
                    ...histDriver, // Keeps team colors, names, pit stops, historical stints
                    ...liveDriver, // Overwrites with live position, interval, gap, lap times
                };
            }
            return histDriver;
        }).sort((a: any, b: any) => {
            // Re-sort the table dynamically based on live position changes
            const posA = Number(a.position || a.official_position || 99);
            const posB = Number(b.position || b.official_position || 99);
            return posA - posB;
        });
    }, [isLiveSession, liveResults, histData.results]);

    // Fallback logic for secondary widgets
    const activeWeather = (isLiveSession && liveWeather) ? liveWeather : histData.weather;
    const activeBests = (isLiveSession && liveBests) ? liveBests : histData.sessionBests;
    const isRaceMode = (isLiveSession && liveResults && liveResults.length > 0) ? liveIsRace : histData.isRace;
    const activeMaxLap = (isLiveSession && liveMaxLap > 0) ? liveMaxLap : histData.maxRaceLap;
    const activeRaceControl = (isLiveSession && liveRc && liveRc.length > 0) ? liveRc : histRaceControl;

    // Toast Notification Handler
    useEffect(() => {
        if (isLiveSession && activeRaceControl && activeRaceControl.length > 0) {
            const newest = activeRaceControl[0];
            setLatestToast((prev: any) => {
                if (!prev || prev.date !== newest.date) return newest;
                return prev;
            });
        }
    }, [activeRaceControl, isLiveSession]);

    // Auto-hide Toast after 10 seconds
    useEffect(() => {
        if (latestToast) {
            const timer = setTimeout(() => {
                setLatestToast(null);
            }, 10000);
            return () => clearTimeout(timer);
        }
    }, [latestToast]);

    // useEffect(() => {
    //     if (isLive && activeRaceControl.length > 0) {
    //         const newest = activeRaceControl[0];
    //         if (!latestToast || newest.date !== latestToast.date) {
    //             setLatestToast(newest);
    //             const t = setTimeout(() => setLatestToast(null), 8000);
    //             return () => clearTimeout(t);
    //         }
    //     }
    // }, [activeRaceControl, isLive, latestToast]);

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
                    ⚠️ {latestToast.message || latestToast.text}
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
                            <div className={`w-2 h-2 rounded-full ${isLiveSession ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`}></div>
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
                                expandableRender={(row) => <DriverExpandedRow driver={row} isLive={isLiveSession} isRaceMode={isRaceMode} />}
                            />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};