import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Table } from '../Utils/Table';
import { useRaceStore } from '../store/useRaceStore';
import type { SessionBests } from '../types';

interface HistDataState {
    results: any[];
    weather: any | null;
    sessionBests: SessionBests | null;
    loading: boolean;
}

const getTyreColor = (compound: string) => {
    const colors: Record<string, string> = { SOFT: '#FF3333', MEDIUM: '#FFFF00', HARD: '#FFFFFF', INTERMEDIATE: '#33CC33', WET: '#0066FF' };
    return colors[compound.toUpperCase()] || '#888888';
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
    const [histData, setHistData] = useState<HistDataState>({ results: [], weather: null, sessionBests: null, loading: !isLive });
    
    const { intervals: liveResults, weather: liveWeather, connect, sessionBests } = useRaceStore();

    useEffect(() => {
        setHistData({ results: [], weather: null, loading: !isLive, sessionBests: null });

        if (isLive) {
            connect();
        } else {
            fetch(`http://localhost:8080/api/race-details/${sessionKey}`)
                .then(r => r.json())
                .then(data => setHistData({ ...data, loading: false }))
                .catch(() => setHistData(prev => ({ ...prev, loading: false })));
        }
    }, [isLive, sessionKey, connect]);

    const activeResults = isLive ? liveResults : histData.results;
    const activeWeather = isLive ? liveWeather : histData.weather;

    // Fallback to histData for Session Bests (if you haven't wired it in the Zustand store yet)
    const activeBests = isLive ? sessionBests : histData.sessionBests;

    const driverColumns = [
        { 
            header: 'Pos', 
            accessor: (row: any) => (
                <div className="flex flex-col items-center">
                    <span className="font-bold text-white text-sm">{row.position}</span>
                    {row.pos_change !== 0 && (
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
                            className={`font-bold hover:underline ${isRetired ? 'text-gray-500' : 'text-blue-400'}`}
                        >
                            {row.name} ({row.driver_number})
                        </Link>
                        {isRetired && (
                            <span className="bg-red-900/30 text-red-500 text-[9px] px-1.5 py-0.5 rounded font-black uppercase tracking-widest border border-red-800/50 shadow-sm ml-2">
                                {row.status}
                            </span>
                        )}
                    </div>
                );
            } 
        },
        { 
            header: 'Interval', 
            accessor: (row: any) => {
                const isRetired = row.status === 'DNF' || row.status === 'DNS';
                return (
                    <span className={`font-mono ${isRetired ? 'text-gray-500' : 'text-gray-300'}`}>
                        {row.interval}
                    </span>
                );
            }
        },
        { 
            header: 'Gap', 
            accessor: (row: any) => {
                const isRetired = row.status === 'DNF' || row.status === 'DNS';
                return (
                    <span className={`font-mono ${isRetired ? 'text-gray-500' : 'text-gray-300'}`}>
                        {row.gap_to_leader}
                    </span>
                );
            }
        }
    ];

    const renderPitSubRow = (driver: any) => (
        <div className="p-4 ml-8 border-l-2 border-gray-700 text-xs text-gray-400 flex flex-col gap-4 bg-gray-900/60 rounded-r border-t border-b border-r border-gray-800/50">
            
            {/* Laps & Sectors */}
            <div className="flex flex-wrap items-start gap-8 text-sm">
                <div>
                    <span className="font-bold text-gray-400 block mb-1">Best Lap:</span> 
                    <span className="font-mono text-white">{driver.best_lap}</span>
                </div>
                <div>
                    <span className="font-bold text-gray-400 block mb-1">Last Lap:</span> 
                    <span className="font-mono text-white">{driver.last_lap}</span>
                </div>
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

            {/* Sleek Tire Timeline Track (Increased pt-6 and pb-8 to make room for floating labels, removed overflow-hidden) */}
            <div className="flex items-center gap-4 pt-6 pb-8">
                <span className="font-bold text-gray-400 w-12 text-xs uppercase tracking-wider">Tyres:</span>
                
                <div className="flex-1 flex items-center relative h-2.5 bg-gray-800 rounded-full">
                    {driver.stints && driver.stints.map((stint: any, i: number) => {
                        const widthPct = (stint.length / driver.total_laps) * 100;
                        const isFirst = i === 0;
                        const isLast = i === driver.stints.length - 1;
                        const tyreColor = getTyreColor(stint.compound);
                        
                        return (
                            <div className="flex h-screen bg-black text-white p-4 gap-6 overflow-hidden">
                                <div className="flex-1 flex flex-col gap-6 overflow-y-auto">
                                    <Link to="/" className="text-gray-400 hover:text-white uppercase tracking-widest text-sm font-bold">← Back to Standings</Link>

                                    {/* Top Info Grid */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {/* Weather Card */}
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

                                        {/* Session Bests Card */}
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
                    })}
                </div>
            </div>

            {/* Pit Stop Duration Summary */}
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
        <div className="flex h-screen bg-black text-white p-4 gap-6 overflow-hidden">
            <div className="flex-1 flex flex-col gap-6 overflow-y-auto">
                <Link to="/" className="text-gray-400 hover:text-white uppercase tracking-widest text-sm font-bold">← Back to Standings</Link>

                <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                    <h2 className="font-bold uppercase tracking-wider text-gray-400 mb-3 text-sm">Track Weather</h2>
                    {activeWeather ? (
                        <div className="flex gap-8 text-sm">
                            <div><span className="text-gray-500">Air:</span> {activeWeather.air_temperature}°C</div>
                            <div><span className="text-gray-500">Track:</span> {activeWeather.track_temperature}°C</div>
                            <div><span className="text-gray-500">Rain:</span> {activeWeather.rainfall ? 'Yes' : 'No'}</div>
                        </div>
                    ) : <span className="text-gray-500 text-sm">Loading weather...</span>}
                </div>

                <div className="bg-gray-900 rounded-xl border border-gray-800 flex-1 flex flex-col overflow-hidden">
                    <div className="p-5 border-b border-gray-800 sticky top-0 z-10 bg-gray-900">
                        <h2 className="font-bold uppercase tracking-wider text-gray-400 text-sm">Race Results</h2>
                    </div>
                    <div className="overflow-y-auto flex-1">
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