import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
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

export const Dashboard = () => {
    const { sessionKey } = useParams();
    const isLive = sessionKey === 'live';
    const [histData, setHistData] = useState<any>({ results: [], weather: null, sessionBests: null, isRace: true, maxRaceLap: 0, loading: !isLive });
    const [histRaceControl, setHistRaceControl] = useState<any[]>([]);
    
    const [rcExpanded, setRcExpanded] = useState(false);
    const [latestToast, setLatestToast] = useState<any>(null);

    const { intervals: liveResults, weather: liveWeather, sessionBests: liveBests, isRace: liveIsRace, maxRaceLap: liveMaxLap, raceControl: liveRc, connect } = useRaceStore();

    useEffect(() => {
        setHistData({ results: [], weather: null, sessionBests: null, isRace: true, loading: !isLive });
        if (isLive) {
            connect();
        } else {
            Promise.all([
                fetch(`http://localhost:8080/api/race-details/${sessionKey}`).then(r => r.json()),
                fetch(`http://localhost:8080/api/race-control/${sessionKey}`).then(r => r.json())
            ]).then(([data, rcData]) => {
                setHistData({ ...data, loading: false });
                setHistRaceControl(rcData);
            }).catch(() => setHistData(prev => ({ ...prev, loading: false })));
        }
    }, [isLive, sessionKey, connect]);

    const activeResults = isLive ? liveResults : histData.results;
    const activeWeather = isLive ? liveWeather : histData.weather;
    const activeBests = isLive && liveBests ? liveBests : histData.sessionBests;
    const isRaceMode = isLive ? liveIsRace : histData.isRace;
    const activeRaceControl = isLive ? liveRc : histRaceControl;
    const activeMaxLap = isLive ? liveMaxLap : histData.maxRaceLap;

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
                        <Link to={`/race/${sessionKey}/driver/${row.driver_number}`} className={`font-bold hover:underline ${isRetired ? 'text-gray-500' : 'text-blue-400'}`}>
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
                return (
                    <span className={`font-mono ${isRetired ? 'text-gray-500' : 'text-gray-300'}`}>
                        {row.driver_laps}
                    </span>
                );
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
                return <span className={`font-mono ${isRetired ? 'text-gray-500' : 'text-gray-300'}`}>{row.gap_to_leader}</span>;
            }
        }
    ];

    const renderPitSubRow = (driver: any) => (
        <div className="p-4 ml-8 border-l-2 border-gray-700 text-xs text-gray-400 flex flex-col gap-4 bg-gray-900/60 rounded-r border-t border-b border-r border-gray-800/50">
            <div className="flex flex-wrap items-start gap-8 text-sm">
                <div><span className="font-bold text-gray-400 block mb-1">Best Lap:</span> <span className="font-mono text-white">{driver.best_lap}</span></div>
                <div><span className="font-bold text-gray-400 block mb-1">Last Lap:</span> <span className="font-mono text-white">{driver.last_lap}</span></div>
                {driver.last_sectors && (
                    <div className="flex gap-6 font-mono text-gray-400 text-xs">
                        <div className="w-16">
                            <span>S1: <strong className="text-gray-300">{driver.last_sectors.s1 ? `${driver.last_sectors.s1.toFixed(3)}s` : '-'}</strong></span>
                            {renderMinisectors(driver.last_sectors.seg1)}
                        </div>
                        <div className="w-16">
                            <span>S2: <strong className="text-gray-300">{driver.last_sectors.s2 ? `${driver.last_sectors.s2.toFixed(3)}s` : '-'}</strong></span>
                            {renderMinisectors(driver.last_sectors.seg2)}
                        </div>
                        <div className="w-16">
                            <span>S3: <strong className="text-gray-300">{driver.last_sectors.s3 ? `${driver.last_sectors.s3.toFixed(3)}s` : '-'}</strong></span>
                            {renderMinisectors(driver.last_sectors.seg3)}
                        </div>
                    </div>
                )}
            </div>

            <div className="flex items-center gap-4 pt-6 pb-8">
                <span className="font-bold text-gray-400 w-12 text-xs uppercase tracking-wider">Tyres:</span>
                <div className="flex-1 flex items-center relative h-2.5 bg-gray-800 rounded-full">
                    {driver.stints && driver.stints.map((stint: any, i: number) => {
                        const widthPct = (stint.length / driver.total_laps) * 100;
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
                <div className="flex flex-wrap items-center gap-3">
                    <span className="font-bold text-gray-400 w-12 text-xs uppercase tracking-wider">Pits:</span>
                    <div className="flex flex-wrap gap-2">
                        {driver.pit_stops.map((p: any, i: number) => (
                            <span key={i} className="bg-gray-800 border border-gray-700 text-gray-300 font-mono px-2 py-0.5 rounded text-[11px]">
                                Lap {p.lap}: <strong className="text-white">{p.duration ? `${p.duration.toFixed(2)}s` : '-'}</strong>
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );

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
                    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 custom-scrollbar bg-gray-900 rounded-b-xl border-t border-gray-800">
                        {activeRaceControl.map((msg: any, i: number) => (
                            <div key={i} className="border-l-2 border-red-500 pl-3 py-1 text-sm bg-gray-800/50 rounded-r">
                                <span className="text-[10px] text-gray-500 font-mono block mb-1">{new Date(msg.date).toLocaleTimeString()} | {msg.category}</span>
                                <span className="text-gray-200 leading-snug">{msg.message}</span>
                            </div>
                        ))}
                        {activeRaceControl.length === 0 && <span className="text-gray-500 italic text-sm">No recent messages.</span>}
                    </div>
                )}
            </div>

            <div className="flex-1 flex flex-col gap-6 overflow-y-auto relative z-10">
                {/* Top Nav with the new Dynamic Lap Counter */}
                <div className="flex justify-between items-center">
                    <Link to="/" className="text-gray-400 hover:text-white uppercase tracking-widest text-sm font-bold">← Back to Standings</Link>
                    
                    {isRaceMode && activeMaxLap > 0 && (
                        <div className="bg-gray-900 border border-gray-700 px-4 py-1.5 rounded-full shadow-lg flex items-center gap-3">
                            <div className={`w-2 h-2 rounded-full ${isLive ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`}></div>
                            <span className="font-bold uppercase tracking-widest text-xs text-gray-400">
                                Total Laps
                            </span>
                            <span className="font-black text-white font-mono text-sm">
                                {activeMaxLap}
                            </span>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                        <h2 className="font-bold uppercase tracking-wider text-gray-400 mb-3 text-xs">Track Weather</h2>
                        {activeWeather ? (
                            <div className="flex justify-between text-sm font-mono text-gray-300">
                                <span>Air: {activeWeather.air_temperature}°C</span>
                                <span>Track: {activeWeather.track_temperature}°C</span>
                                <span>Rain: {activeWeather.rainfall ? 'Yes' : 'No'}</span>
                            </div>
                        ) : <span className="text-gray-500 text-sm">Loading weather...</span>}
                    </div>

                    <div className="bg-gray-900 rounded-xl p-5 border border-purple-900/50 shadow-[0_0_15px_rgba(168,85,247,0.1)]">
                        <h2 className="font-bold uppercase tracking-wider text-purple-400 mb-3 text-xs flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse"></span> Session Bests
                        </h2>
                        {activeBests ? (
                            <div className="flex justify-between text-xs font-mono text-gray-300">
                                <div><span className="text-gray-500 block">Fastest Lap</span> {activeBests.lap.time} <span className="text-purple-400">({activeBests.lap.driver})</span></div>
                                <div><span className="text-gray-500 block">Sector 1</span> {activeBests.s1.time}s <span className="text-purple-400">({activeBests.s1.driver})</span></div>
                                <div><span className="text-gray-500 block">Sector 2</span> {activeBests.s2.time}s <span className="text-purple-400">({activeBests.s2.driver})</span></div>
                                <div><span className="text-gray-500 block">Sector 3</span> {activeBests.s3.time}s <span className="text-purple-400">({activeBests.s3.driver})</span></div>
                            </div>
                        ) : <span className="text-gray-500 text-sm">Calculating bests...</span>}
                    </div>
                </div>

                <div className="bg-gray-900 rounded-xl border border-gray-800 flex-1 flex flex-col overflow-hidden shadow-2xl">
                    <div className="overflow-y-auto flex-1 custom-scrollbar relative">
                        {histData.loading ? (
                            <div className="p-10 text-center text-gray-500 animate-pulse">Fetching Race Data...</div>
                        ) : (
                            <Table data={activeResults || []} columns={driverColumns} expandableRender={renderPitSubRow} />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};