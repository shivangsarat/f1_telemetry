import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Table } from '../Utils/Table';
import { useRaceStore } from '../store/useRaceStore';

const getTyreColor = (compound: string) => {
    const colors: Record<string, string> = { SOFT: '#FF3333', MEDIUM: '#FFFF00', HARD: '#FFFFFF', INTERMEDIATE: '#33CC33', WET: '#0066FF' };
    return colors[compound?.toUpperCase()] || '#888888';
};

const getSegmentColor = (val: number) => {
    switch(val) {
        case 2048: return 'bg-yellow-400';
        case 2049: return 'bg-green-500';
        case 2051: return 'bg-purple-500';
        case 2064: return 'bg-blue-500'; 
        default: return 'bg-gray-700'; 
    }
};

const renderMinisectors = (segments: number[]) => {
    if (!segments || segments.length === 0) return null;
    return (
        <div className="flex h-1.5 w-full mt-1 gap-[1px]">
            {segments.map((val, i) => <div key={i} className={`flex-1 ${getSegmentColor(val)} rounded-sm`} />)}
        </div>
    );
};

const getFlagTheme = (flag: string) => {
    switch(flag?.toUpperCase()) {
        case 'YELLOW': 
        case 'DOUBLE YELLOW': return { border: 'border-yellow-500', bg: 'bg-yellow-500/10', text: 'text-yellow-400', icon: '🟨' };
        case 'RED': return { border: 'border-red-500', bg: 'bg-red-500/10', text: 'text-red-500', icon: '🟥' };
        case 'GREEN': 
        case 'CLEAR': return { border: 'border-green-500', bg: 'bg-green-500/10', text: 'text-green-400', icon: '🟩' };
        case 'BLUE': return { border: 'border-blue-500', bg: 'bg-blue-500/10', text: 'text-blue-400', icon: '🟦' };
        case 'CHEQUERED': return { border: 'border-white', bg: 'bg-white/10', text: 'text-white', icon: '🏁' };
        case 'BLACK AND WHITE': return { border: 'border-gray-400', bg: 'bg-gray-400/10', text: 'text-gray-300', icon: '🏴' };
        default: return { border: 'border-gray-600', bg: 'bg-gray-800/50', text: 'text-gray-300', icon: 'ℹ️' };
    }
};

export const Dashboard = () => {
    const { sessionKey } = useParams();
    const navigate = useNavigate();
    const isLive = sessionKey === 'live';
    
    const [histData, setHistData] = useState<any>({ results: [], weather: null, sessionBests: null, isRace: true, maxRaceLap: 0, availableSessions: [], loading: !isLive });
    const [histRaceControl, setHistRaceControl] = useState<any[]>([]);
    
    const [rcExpanded, setRcExpanded] = useState(false);
    const [latestToast, setLatestToast] = useState<any>(null);
    const [expandedDriver, setExpandedDriver] = useState<number | null>(null);

    const { intervals: liveResults, weather: liveWeather, sessionBests: liveBests, isRace: liveIsRace, maxRaceLap: liveMaxLap, raceControl: liveRc, connect } = useRaceStore();

    useEffect(() => {
        setHistData({ results: [], weather: null, sessionBests: null, isRace: true, maxRaceLap: 0, availableSessions: [], loading: !isLive });
        if (isLive) {
            connect();
        } else {
            Promise.all([
                fetch(`http://localhost:8080/api/race-details/${sessionKey}`).then(r => r.json()),
                fetch(`http://localhost:8080/api/race-control/${sessionKey}`).then(r => r.json())
            ]).then(([data, rcData]) => {
                if (data.active_session_key && String(data.active_session_key) !== String(sessionKey)) {
                    navigate(`/race/${data.active_session_key}`, { replace: true });
                    return;
                }
                setHistData({ ...data, loading: false });
                setHistRaceControl(rcData);
            }).catch(() => setHistData(prev => ({ ...prev, loading: false })));
        }
    }, [isLive, sessionKey, connect, navigate]);

    const activeResults = isLive ? liveResults : histData.results;
    const activeWeather = isLive ? liveWeather : histData.weather;
    const activeBests = isLive && liveBests ? liveBests : histData.sessionBests;
    const isRaceMode = isLive ? liveIsRace : histData.isRace;
    const activeMaxLap = isLive ? liveMaxLap : histData.maxRaceLap;
    const activeRaceControl = isLive ? liveRc : histRaceControl;

    useEffect(() => {
        if (isLive && activeRaceControl.length > 0) {
            const newest = activeRaceControl[0];
            if (!latestToast || newest.date !== latestToast.date) {
                setLatestToast(newest);
                const t = setTimeout(() => setLatestToast(null), 8000);
                return () => clearTimeout(t);
            }
        }
    }, [activeRaceControl, isLive]);

    const driverColumns = [
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
                        <Link 
                            to={`/race/${sessionKey}/driver/${row.driver_number}`} 
                            onClick={(e) => e.stopPropagation()} 
                            className={`font-bold hover:underline ${isRetired ? 'text-gray-500' : 'text-blue-400'}`}
                        >
                            {row.name} ({row.driver_number})
                        </Link>
                        {isRetired && <span className="bg-red-900/30 text-red-500 text-[9px] px-1.5 py-0.5 rounded font-black uppercase tracking-widest border border-red-800/50 shadow-sm ml-2">{row.status}</span>}
                    </div>
                );
            } 
        },
        { 
            header: 'Laps', 
            accessor: (row: any) => {
                const isRetired = row.status === 'DNF' || row.status === 'DNS';
                return <span className={`font-mono ${isRetired ? 'text-gray-500' : 'text-gray-300'}`}>{row.driver_laps}</span>;
            }
        },
        { 
            header: isRaceMode ? 'Interval' : 'Best Lap', 
            accessor: (row: any) => {
                const isRetired = row.status === 'DNF' || row.status === 'DNS';
                return <span className={`font-mono ${isRetired ? 'text-gray-500' : 'text-gray-300'}`}>{isRaceMode ? row.interval : row.best_lap}</span>;
            }
        },
        { 
            header: isRaceMode ? 'Gap' : 'Gap to P1', 
            accessor: (row: any) => {
                const isRetired = row.status === 'DNF' || row.status === 'DNS';
                return (
                    <div className="flex items-center justify-between w-full pr-4">
                        <span className={`font-mono ${isRetired ? 'text-gray-500' : 'text-gray-300'}`}>{row.gap_to_leader}</span>
                        <span className="text-[10px] uppercase tracking-widest text-gray-600 font-bold group-hover:text-blue-400 transition-colors">
                            Toggle Details
                        </span>
                    </div>
                );
            }
        }
    ];

    const renderSectorBlock = (sectors: any) => {
        if (!sectors) return null;
        return (
            <div className="flex gap-6 font-mono text-gray-300 text-xs mt-1">
                <div className="w-20 flex flex-col justify-end">
                    <span className="block text-gray-500 mb-0.5">S1:</span>
                    <strong className="text-white text-sm block mb-1">{sectors.s1 ? `${sectors.s1.toFixed(3)}s` : '-'}</strong>
                    <div className="h-8 flex flex-col justify-start">
                        {sectors.i1_speed && <span className="text-[10px] text-gray-100 font-bold leading-tight">I1: {sectors.i1_speed}<br/>km/h</span>}
                    </div>
                    {renderMinisectors(sectors.seg1)}
                </div>
                <div className="w-20 flex flex-col justify-end">
                    <span className="block text-gray-500 mb-0.5">S2:</span>
                    <strong className="text-white text-sm block mb-1">{sectors.s2 ? `${sectors.s2.toFixed(3)}s` : '-'}</strong>
                    <div className="h-8 flex flex-col justify-start">
                        {sectors.i2_speed && <span className="text-[10px] text-gray-100 font-bold leading-tight">I2: {sectors.i2_speed}<br/>km/h</span>}
                    </div>
                    {renderMinisectors(sectors.seg2)}
                </div>
                <div className="w-20 flex flex-col justify-end">
                    <span className="block text-gray-500 mb-0.5">S3:</span>
                    <strong className="text-white text-sm block mb-1">{sectors.s3 ? `${sectors.s3.toFixed(3)}s` : '-'}</strong>
                    <div className="h-8 flex flex-col justify-start">
                        {sectors.st_speed && <span className="text-[10px] text-purple-300 font-bold leading-tight">Trap: {sectors.st_speed}<br/>km/h</span>}
                    </div>
                    {renderMinisectors(sectors.seg3)}
                </div>
            </div>
        );
    };

    const renderPitSubRow = (driver: any) => {
        const showCurrent = isLive && !isRaceMode;
        const displaySectors = isRaceMode ? driver.last_sectors : driver.best_sectors;

        return (
            <div className="p-4 ml-8 border-l-2 border-gray-700 text-xs text-gray-300 flex flex-col gap-4 bg-gray-900/80 rounded-r border-t border-b border-r border-gray-800">
                <div className="flex flex-wrap items-start gap-12 text-sm">
                    <div className="flex flex-col gap-1">
                        <div>
                            <span className="font-bold text-gray-400 block mb-1">Best Lap:</span> 
                            <span className="font-mono text-white text-lg font-bold">{driver.best_lap}</span>
                        </div>
                        {(!isRaceMode && driver.best_sectors) && renderSectorBlock(driver.best_sectors)}
                    </div>
                    
                    {(isRaceMode || showCurrent) && (
                        <div className={`flex flex-col gap-1 ${!isRaceMode ? 'border-l border-gray-700/50 pl-8' : ''}`}>
                            <div>
                                <span className="font-bold text-gray-400 block mb-1">{isRaceMode ? 'Last Lap:' : 'Current Lap:'}</span> 
                                <span className="font-mono text-white text-lg font-bold">
                                    {(driver.last_lap === '-' && showCurrent) ? 'In Progress' : driver.last_lap}
                                </span>
                            </div>
                            {displaySectors && renderSectorBlock(displaySectors)}
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-4 pt-6 pb-8">
                    <span className="font-bold text-gray-400 w-12 text-xs uppercase tracking-wider">Tyres:</span>
                    <div className="flex-1 flex items-center relative h-2.5 bg-gray-800 rounded-full">
                        {driver.stints && driver.stints.map((stint: any, i: number) => {
                            const widthPct = (stint.length / Math.max(driver.total_laps, 1)) * 100;
                            const isFirst = i === 0;
                            const isLast = i === driver.stints.length - 1;
                            const tyreColor = getTyreColor(stint.compound);
                            
                            return (
                                <div key={i} className="h-full relative flex items-center justify-center transition-all duration-500"
                                    style={{ width: `${widthPct}%`, backgroundColor: tyreColor, borderTopLeftRadius: isFirst ? '9999px' : '0', borderBottomLeftRadius: isFirst ? '9999px' : '0', borderTopRightRadius: isLast ? '9999px' : '0', borderBottomRightRadius: isLast ? '9999px' : '0' }}>
                                    {stint.length > 2 && <span className="absolute -top-6 text-[11px] font-bold font-mono tracking-tight drop-shadow-sm" style={{ color: tyreColor }}>{stint.length}L</span>}
                                    {i > 0 && (
                                        <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 flex flex-col items-center">
                                            <div className="w-4 h-4 rounded-full border-2 border-gray-900 shadow-lg shadow-black/80" style={{ backgroundColor: tyreColor }} />
                                            <span className="absolute top-4 text-[10px] font-bold font-mono text-gray-200 bg-gray-900 px-1.5 py-0.5 rounded border border-gray-700 shadow-md">L{stint.start}</span>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
                
                {driver.pit_stops && driver.pit_stops.length > 0 && (
                    <div className="flex items-start gap-4 pt-4 border-t border-gray-800">
                        <span className="font-bold text-gray-400 w-12 text-xs uppercase tracking-wider mt-1">Pits:</span>
                        <div className="flex flex-wrap gap-2">
                            {driver.pit_stops.map((p: any, i: number) => (
                                <div key={i} className="bg-gray-800 border border-gray-700 font-mono px-3 py-1.5 rounded flex flex-col gap-0.5 min-w-[100px]">
                                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Lap {p.lap}</span>
                                    {p.stop_duration && <span>Box: <strong className="text-white">{p.stop_duration.toFixed(2)}s</strong></span>}
                                    {p.lane_duration && <span>Lane: <strong className="text-gray-200">{p.lane_duration.toFixed(2)}s</strong></span>}
                                    {(!p.stop_duration && !p.lane_duration && p.pit_duration) && <span>Time: <strong className="text-white">{p.pit_duration.toFixed(2)}s</strong></span>}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="flex h-screen bg-black text-white p-4 gap-6 overflow-hidden relative">
            
            {latestToast && (
                <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] bg-red-600 text-white px-6 py-3 rounded-full shadow-2xl font-bold uppercase tracking-wider animate-bounce flex items-center gap-3 border border-red-400">
                    ⚠️ {latestToast.message}
                </div>
            )}

            <div className={`fixed bottom-6 right-6 z-[60] bg-gray-900 border ${rcExpanded ? 'border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.2)]' : 'border-gray-700'} rounded-xl transition-all duration-300 flex flex-col`} style={{ width: '380px', maxHeight: '500px' }}>
                <button onClick={() => setRcExpanded(!rcExpanded)} className="p-3 font-bold uppercase text-xs tracking-widest text-left flex justify-between items-center bg-gray-800 rounded-t-xl text-red-400 hover:bg-gray-700 transition">
                    Race Control News {activeRaceControl.length > 0 && `(${activeRaceControl.length})`}
                    <span>{rcExpanded ? '▼' : '▲'}</span>
                </button>
                {rcExpanded && (
                    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2 custom-scrollbar bg-gray-900 rounded-b-xl border-t border-gray-800">
                        {activeRaceControl.map((msg: any, i: number) => {
                            const theme = getFlagTheme(msg.flag);
                            return (
                                <div key={i} className={`border-l-4 ${theme.border} ${theme.bg} pl-3 py-2 text-sm rounded-r`}>
                                    <div className="flex justify-between items-start mb-1">
                                        <span className="text-[10px] text-gray-400 font-mono tracking-widest">{new Date(msg.date).toLocaleTimeString()} | {msg.category}</span>
                                        <span className="text-lg leading-none">{theme.icon}</span>
                                    </div>
                                    <span className={`${theme.text} leading-snug font-medium block`}>{msg.message}</span>
                                </div>
                            );
                        })}
                        {activeRaceControl.length === 0 && <span className="text-gray-500 italic text-sm">No recent messages.</span>}
                    </div>
                )}
            </div>

            <div className="flex-1 flex flex-col gap-6 overflow-y-auto relative z-10">
                
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-6">
                        <Link to="/" className="text-gray-400 hover:text-white uppercase tracking-widest text-sm font-bold">← Back</Link>
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
                    {/* NEW: 7-Metric Expanded Grid Layout for Track Weather */}
                    <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 flex flex-col justify-center">
                        <h2 className="font-bold uppercase tracking-wider text-gray-400 mb-4 text-xs">Track Weather</h2>
                        {activeWeather ? (
                            <div className="grid grid-cols-4 gap-y-4 gap-x-2 text-xs font-mono text-gray-300">
                                <div><span className="text-gray-500 block text-[10px] uppercase">Air</span> {activeWeather.air_temperature}°C</div>
                                <div><span className="text-gray-500 block text-[10px] uppercase">Track</span> {activeWeather.track_temperature}°C</div>
                                <div><span className="text-gray-500 block text-[10px] uppercase">Humidity</span> {activeWeather.humidity}%</div>
                                <div><span className="text-gray-500 block text-[10px] uppercase">Rain</span> {activeWeather.rainfall ? 'Yes' : 'No'}</div>
                                <div><span className="text-gray-500 block text-[10px] uppercase">Pressure</span> {activeWeather.pressure} mbar</div>
                                <div><span className="text-gray-500 block text-[10px] uppercase">Wind Dir</span> {activeWeather.wind_direction}°</div>
                                <div><span className="text-gray-500 block text-[10px] uppercase">Wind Spd</span> {activeWeather.wind_speed} m/s</div>
                            </div>
                        ) : <span className="text-gray-500 text-sm">Loading weather...</span>}
                    </div>

                    <div className="bg-gray-900 rounded-xl p-5 border border-purple-900/50 shadow-[0_0_15px_rgba(168,85,247,0.1)] flex flex-col justify-center">
                        <h2 className="font-bold uppercase tracking-wider text-purple-400 mb-4 text-xs flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse"></span> Session Bests
                        </h2>
                        {activeBests ? (
                            <div className="flex justify-between text-xs font-mono text-gray-300">
                                <div><span className="text-gray-500 block text-[10px] uppercase">Fastest Lap</span> {activeBests.lap.time} <span className="text-purple-400">({activeBests.lap.driver})</span></div>
                                <div><span className="text-gray-500 block text-[10px] uppercase">Sector 1</span> {activeBests.s1.time}s <span className="text-purple-400">({activeBests.s1.driver})</span></div>
                                <div><span className="text-gray-500 block text-[10px] uppercase">Sector 2</span> {activeBests.s2.time}s <span className="text-purple-400">({activeBests.s2.driver})</span></div>
                                <div><span className="text-gray-500 block text-[10px] uppercase">Sector 3</span> {activeBests.s3.time}s <span className="text-purple-400">({activeBests.s3.driver})</span></div>
                            </div>
                        ) : <span className="text-gray-500 text-sm">Calculating bests...</span>}
                    </div>
                </div>

                <div className="bg-gray-900 rounded-xl border border-gray-800 flex-1 flex flex-col overflow-hidden shadow-2xl">
                    <div className="overflow-y-auto flex-1 custom-scrollbar relative">
                        {histData.loading ? (
                            <div className="p-10 text-center text-gray-500 animate-pulse">Fetching Session Data...</div>
                        ) : (
                            <Table 
                                data={activeResults || []} 
                                columns={driverColumns} 
                                expandableRender={renderPitSubRow}
                                getRowKey={(row: any) => row.driver_number}
                            />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};