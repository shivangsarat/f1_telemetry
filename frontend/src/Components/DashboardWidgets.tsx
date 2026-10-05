import React, { useState, useRef, useLayoutEffect, useEffect } from 'react';
import { getFlagTheme, getTyreColor, getF1Points } from '../Utils/helpers';
import { SectorBlock } from './TelemetryWidgets';
import { useRaceStore } from '../store/useRaceStore';
import uPlot from 'uplot';

export const WeatherCard = React.memo(({ weather }: { weather: any }) => (
    <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 flex flex-col justify-center">
        <h2 className="font-bold uppercase tracking-wider text-gray-400 mb-4 text-xs">Track Weather</h2>
        {weather ? (
            <div className="grid grid-cols-4 gap-y-4 gap-x-2 text-xs font-mono text-gray-300">
                <div><span className="text-gray-400 block text-[10px] uppercase">Air</span> {weather.air_temperature}°C</div>
                <div><span className="text-gray-400 block text-[10px] uppercase">Track</span> {weather.track_temperature}°C</div>
                <div><span className="text-gray-400 block text-[10px] uppercase">Humidity</span> {weather.humidity}%</div>
                <div><span className="text-gray-400 block text-[10px] uppercase">Rain</span> {weather.rainfall ? 'Yes' : 'No'}</div>
                <div><span className="text-gray-400 block text-[10px] uppercase">Pressure</span> {weather.pressure} mb</div>
                <div><span className="text-gray-400 block text-[10px] uppercase">Wind Dir</span> {weather.wind_direction}°</div>
                <div><span className="text-gray-400 block text-[10px] uppercase">Wind Spd</span> {weather.wind_speed} m/s</div>
            </div>
        ) : <span className="text-gray-500 text-sm">Loading weather...</span>}
    </div>
));

export const SessionBestsCard = React.memo(({ bests }: { bests: any }) => (
    <div className="bg-gray-900 rounded-xl p-5 border border-purple-900/50 shadow-[0_0_15px_rgba(168,85,247,0.1)] flex flex-col justify-center">
        <h2 className="font-bold uppercase tracking-wider text-purple-400 mb-4 text-xs flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse"></span> Session Bests
        </h2>
        {bests ? (
            <div className="flex justify-between text-xs font-mono text-gray-300">
                <div><span className="text-gray-400 block text-[10px] uppercase">Fastest Lap</span> {bests.lap.time} <span className="text-purple-400">({bests.lap.driver})</span></div>
                <div><span className="text-gray-400 block text-[10px] uppercase">Sector 1</span> {bests.s1.time}s <span className="text-purple-400">({bests.s1.driver})</span></div>
                <div><span className="text-gray-400 block text-[10px] uppercase">Sector 2</span> {bests.s2.time}s <span className="text-purple-400">({bests.s2.driver})</span></div>
                <div><span className="text-gray-400 block text-[10px] uppercase">Sector 3</span> {bests.s3.time}s <span className="text-purple-400">({bests.s3.driver})</span></div>
            </div>
        ) : <span className="text-gray-500 text-sm">Calculating bests...</span>}
    </div>
));

export const RaceControlWidget = React.memo(({ messages, latestToast }: { messages: any[], latestToast?: any }) => {
    const [expanded, setExpanded] = useState(false);
    
    let toastTheme = null;
    if (latestToast) {
        toastTheme = getFlagTheme(latestToast.flag);
    }

    return (
        <div className="fixed bottom-6 right-6 z-[60] flex flex-col items-end gap-3" style={{ width: '380px' }}>
            {latestToast && toastTheme && (
                <div className={`w-full border-l-4 ${toastTheme.border} ${toastTheme.bg} bg-gray-900 shadow-2xl pl-3 py-3 pr-4 rounded-xl animate-bounce border border-gray-700/50 backdrop-blur-md`}>
                    <div className="flex justify-between items-start mb-1">
                        <span className="text-[10px] text-gray-400 font-mono tracking-widest uppercase font-bold">
                            {new Date(latestToast.date).toLocaleTimeString()} | NEW ALERT
                        </span>
                        <span className="text-xl leading-none shadow-sm">{toastTheme.icon}</span>
                    </div>
                    <span className={`${toastTheme.text} leading-snug font-bold block text-sm`}>{latestToast.message || latestToast.text}</span>
                </div>
            )}

            <div className={`w-full bg-gray-900 border ${expanded ? 'border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.2)]' : 'border-gray-700'} rounded-xl transition-all duration-300 flex flex-col`} style={{ maxHeight: '500px' }}>
                <button onClick={() => setExpanded(!expanded)} className={`p-3 font-bold uppercase text-xs tracking-widest text-left flex justify-between items-center bg-gray-800 rounded-t-xl ${expanded ? '' : 'rounded-b-xl'} text-red-400 hover:bg-gray-700 transition`}>
                    Race Control News {messages.length > 0 && `(${messages.length})`}
                    <span>{expanded ? '▼' : '▲'}</span>
                </button>
                {expanded && (
                    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2 custom-scrollbar bg-gray-900 rounded-b-xl border-t border-gray-800">
                        {messages.map((msg, i) => {
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
                        {messages.length === 0 && <span className="text-gray-500 italic text-sm">No recent messages.</span>}
                    </div>
                )}
            </div>
        </div>
    );
});

// --- HELPER: Mid-lap progression for smooth timeline animation ---
const calculatePartialLapProgress = (driver: any) => {
    if (driver.status === 'Finished' || driver.status === 'DNF' || driver.status?.toUpperCase().includes('OUT') || driver.status === 'Retired') return 0;
    let fraction = 0;
    const seg1 = driver.segments_sector_1 || driver.seg1;
    const seg2 = driver.segments_sector_2 || driver.seg2;
    const seg3 = driver.segments_sector_3 || driver.seg3;

    if (seg3 && seg3.length > 0) fraction = 0.66 + (Math.min(seg3.length, 10) / 10) * 0.33;
    else if (seg2 && seg2.length > 0) fraction = 0.33 + (Math.min(seg2.length, 10) / 10) * 0.33;
    else if (seg1 && seg1.length > 0) fraction = (Math.min(seg1.length, 10) / 10) * 0.33;
    else {
        if (driver.s2) fraction = 0.66;
        else if (driver.s1) fraction = 0.33;
        else fraction = 0.05; 
    }
    return Math.min(fraction, 0.99); 
};

// // --- HELPER: Clean interval strings ---
// const getIntervalStr = (d: any) => {
//     let val = d.interval ? String(d.interval) : (d.gap_to_leader ? String(d.gap_to_leader) : '0.000s');
//     val = val.replace(/\++/g, '+').replace(/s+/g, 's'); // Clean double chars
//     const upVal = val.toUpperCase();
//     if (!val.startsWith('+') && !upVal.includes('LAP') && val !== '0.000s' && upVal !== 'LEADER') val = '+' + val;
//     if (!val.endsWith('s') && !upVal.includes('LAP') && upVal !== 'LEADER') val = val + 's';
//     return val;
// };


// --- COMPONENT: Championship Points Widget (Replaces Live Battles) ---
export const DriverChampionshipWidget = ({ driver, liveStandings }: { driver: any, liveStandings?: any }) => {
    const pointsBefore = driver.championship?.pointsStart ?? 0;
    const posStart = driver.championship?.position !== '-' ? driver.championship?.position : '-';

    let pointsAddition = 0;
    let pointsAfter = 0;
    let projectedPos = '-';
    let posChange = 0;
    let isFinished = false;

    if (liveStandings && liveStandings[driver.driver_number]) {
        const stats = liveStandings[driver.driver_number];
        pointsAddition = stats.pointsAddition;
        pointsAfter = stats.pointsAfter;
        projectedPos = stats.projectedPos;
        posChange = stats.posChange;
        isFinished = stats.isFinished;
    } else {
        const currentPos = driver.position || driver.official_position || 99;
        isFinished = driver.status === 'Finished' || driver.status === 'Classified';
        pointsAddition = getF1Points(currentPos, false);
        pointsAfter = isFinished ? (driver.championship?.points ?? (pointsBefore + pointsAddition)) : pointsBefore + pointsAddition;
    }

    return (
        <div className="flex flex-col gap-1.5 h-full">
            <div className="flex justify-between items-center">
                <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Championship Standings</h3>
                {projectedPos !== '-' && (
                    <span className={`text-[10px] font-bold uppercase tracking-widest ${posChange > 0 ? 'text-green-500' : posChange < 0 ? 'text-red-500' : 'text-gray-500'}`}>
                        {posChange > 0 ? '▲' : posChange < 0 ? '▼' : '▬'} {Math.abs(posChange)} Pos
                    </span>
                )}
            </div>
            <div className="bg-gray-800/40 p-2 rounded-md border border-gray-700/60 shadow-inner flex flex-col gap-1 text-xs flex-1 justify-center">
                <div className="flex justify-between items-center">
                    <span className="text-gray-500 uppercase tracking-widest text-[9px] font-bold">Start: P{posStart}</span>
                    <span className="font-bold text-gray-300 font-mono">{pointsBefore} PTS</span>
                </div>
                <div className="flex justify-between items-center border-t border-gray-700/50 pt-1 mt-0.5">
                    <span className="text-gray-500 uppercase tracking-widest text-[9px] font-bold">Race Addition</span>
                    <span className="font-bold text-green-400 font-mono">+{pointsAddition} PTS</span>
                </div>
                <div className="flex justify-between items-center border-t border-gray-700/50 pt-1 mt-0.5">
                    <span className="text-gray-300 uppercase tracking-widest text-[9px] font-bold">
                        {isFinished ? `Final: P${projectedPos}` : `Projected: P${projectedPos}`}
                    </span>
                    <span className="font-bold text-white font-mono text-sm">{pointsAfter} PTS</span>
                </div>
            </div>
        </div>
    );
};


export const DriverAnalyticsWidget = ({ analytics, driver }: { analytics: any, driver: any }) => {
    if (!analytics) return <div className="text-xs text-gray-500 italic h-full flex items-center pl-6 border-l border-gray-800/50">Analytics loading...</div>;

    const { currentStintLength, maxLapsOnCompound, paceDropOff, driverSpeed, speedRank, speedDeficit, consistencyStdDev } = analytics;

    return (
        <div className="flex flex-col justify-center h-full pl-6 border-l border-gray-800/50">
            <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider mb-2">Stint & Performance Analytics</h3>
            
            <div className="bg-gray-800/40 rounded-md border border-gray-700/60 flex flex-col text-xs shadow-inner">
                
                {/* Row 1: Tyre Age & Pace Drop-off */}
                <div className="flex justify-between items-center px-3 py-1.5 border-b border-gray-700/60">
                    <div className="flex items-baseline gap-2">
                        <span className="text-gray-400 uppercase font-bold w-20 text-[10px]">Tyre Age</span>
                        <span className="text-white font-bold">
                            {analytics.currentTyreAge || currentStintLength} Laps <span className="text-gray-300 text-[11px] font-normal ml-1">/ Est. {maxLapsOnCompound}</span>
                        </span>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-gray-400 uppercase font-bold text-[10px]">Pace Drop</span>
                        <span className={`font-bold font-mono ${paceDropOff > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
                            {paceDropOff > 0 ? '+' : ''}{paceDropOff.toFixed(3)}s
                        </span>
                    </div>
                </div>

                {/* Row 2: Speed Trap & Deficit */}
                <div className="flex justify-between items-center px-3 py-1.5 border-b border-gray-700/60">
                    <div className="flex items-baseline gap-2">
                        <span className="text-gray-400 uppercase font-bold w-20 text-[10px]">Speed Trap</span>
                        <span className="text-purple-400 font-bold">
                            {driverSpeed || driver.st_speed || 0} km/h <span className="text-gray-300 text-[11px] font-normal ml-1">(P{speedRank})</span>
                        </span>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-gray-400 uppercase font-bold text-[10px]">Vs Best</span>
                        <span className="text-gray-200 font-bold font-mono">
                            {speedDeficit > 0 ? `-${speedDeficit.toFixed(1)} km/h` : 'Leader'}
                        </span>
                    </div>
                </div>

                {/* Row 3: Consistency */}
                <div className="flex justify-between items-center px-3 py-1.5">
                    <div className="flex items-baseline gap-2">
                        <span className="text-gray-400 uppercase font-bold w-20 text-[10px]">Consistency</span>
                        <span className="text-white font-bold font-mono">± {consistencyStdDev.toFixed(3)}s</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-gray-400 uppercase font-bold text-[10px]">Var.</span>
                        <div className="w-16 h-1.5 bg-gray-900 rounded-full overflow-hidden flex items-center justify-end border border-gray-700/50">
                            <div 
                                className={`h-full transition-all duration-500 ${consistencyStdDev < 0.2 ? 'bg-green-500' : consistencyStdDev < 0.5 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                style={{ width: `${Math.max(10, 100 - (consistencyStdDev * 100))}%` }}
                            ></div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};

export const DriverExpandedRow = React.memo(({ driver, isLive, isRaceMode, liveStandings }: { driver: any, isLive: boolean, isRaceMode: boolean, liveStandings?: any }) => {
    const showCurrent = isLive && !isRaceMode;
    const displaySectors = isRaceMode ? driver.last_sectors : driver.best_sectors;

    

    const { pit_stops } = driver;

    // --- TIMELINE SCALE LOGIC ---
    const allDrivers = useRaceStore(state => state.intervals) || [];
    const maxRaceLapStore = useRaceStore(state => state.maxRaceLap);
    
    // Check driver status to control the progress bar behavior
    const isDNF = driver.status === 'DNF' || driver.status?.toUpperCase().includes('OUT') || driver.status === 'Retired';
    const isFinished = driver.status === 'Finished' || (!isLive && !isDNF);

    const currentLeaderLap = allDrivers.length > 0 ? Math.max(...allDrivers.map(d => d.completed_laps || 0)) : 1;
    const globalMaxLap = (maxRaceLapStore && maxRaceLapStore > 0) ? maxRaceLapStore : currentLeaderLap;
    
    const partialLap = (isLive && !isFinished && !isDNF) ? calculatePartialLapProgress(driver) : 0;
    const currentDistance = (driver.completed_laps || 0) + partialLap;

    let scaleMax = globalMaxLap;
    if (isFinished) {
        scaleMax = currentDistance; 
    } else if (!maxRaceLapStore) {
        scaleMax = isDNF ? globalMaxLap : Math.max(currentDistance, 1);
    } else {
        scaleMax = maxRaceLapStore;
    }
    scaleMax = Math.max(scaleMax, 1); // Safety floor

    const latestPit = pit_stops && pit_stops.length > 0 ? pit_stops[pit_stops.length - 1] : null;


    return (
        <div className="p-4 ml-8 border-l-2 border-gray-700 text-xs text-gray-300 flex flex-col gap-4 bg-gray-900/80 rounded-r border-t border-b border-r border-gray-800">
            {/* --- TOP SECTION GRID: 3 Columns --- */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full">
                {/* LEFT COLUMN (Width: 4 cols): Best Lap & Last Lap */}
                <div className="lg:col-span-4 flex flex-wrap items-start gap-12 text-sm">
                    <div className="flex flex-col gap-1">
                        <div>
                            <span className="font-bold text-gray-400 block mb-1">Best Lap:</span> 
                            <span className="font-mono text-white text-lg font-bold">{driver.best_lap}</span>
                        </div>
                        {(!isRaceMode && driver.best_sectors) && <SectorBlock sectors={driver.best_sectors} />}
                    </div>
                    
                    {(isRaceMode || showCurrent) && (
                        <div className={`flex flex-col gap-1 ${!isRaceMode ? 'border-l border-gray-700/50 pl-8' : ''}`}>
                            <div>
                                <span className="font-bold text-gray-400 block mb-1">{isRaceMode ? 'Last Lap:' : 'Current Lap:'}</span> 
                                <span className="font-mono text-white text-lg font-bold">
                                    {(driver.last_lap === '-' && showCurrent) ? 'In Progress' : driver.last_lap}
                                </span>
                            </div>
                            {displaySectors && <SectorBlock sectors={displaySectors} />}
                        </div>
                    )}
                </div>
                {/* CENTER COLUMN (Width: 3 cols): Live Battles & Latest Pit Summary */}
                <div className="lg:col-span-3 flex flex-col justify-center gap-3 pl-4 pr-2 border-l border-gray-800/50">
                    
                    {/* CHAMPIONSHIP POINTS MODULE (Replaces Live Battles) */}
                    <DriverChampionshipWidget driver={driver} liveStandings={liveStandings} />

                    {/* LATEST PIT MODULE */}
                    <div className="flex flex-col gap-1.5">
                        <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Latest Pit Stop</h3>
                        <div className="bg-gray-800/40 p-2 rounded-md border border-gray-700/60 shadow-inner flex flex-col gap-1 text-xs">
                            {latestPit ? (
                                <>
                                    <div className="flex justify-between items-center">
                                        <span className="text-gray-300 font-bold uppercase tracking-widest text-[10px]">Lap {latestPit.lap}</span>
                                        <span className="font-bold text-white font-mono">{latestPit.pit_duration ? `${latestPit.pit_duration.toFixed(2)}s` : 'N/A'}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-[10px] border-t border-gray-700/50 pt-1 mt-0.5">
                                        <span className="text-gray-500 font-bold">Box: <strong className="text-gray-300 font-mono ml-0.5">{latestPit.stop_duration ? `${latestPit.stop_duration.toFixed(2)}s` : '-'}</strong></span>
                                        <span className="text-gray-500 font-bold">Lane: <strong className="text-gray-300 font-mono ml-0.5">{latestPit.lane_duration ? `${latestPit.lane_duration.toFixed(2)}s` : '-'}</strong></span>
                                    </div>
                                </>
                            ) : (
                                <div className="text-center text-gray-500 text-[10px] font-bold uppercase tracking-widest py-2">
                                    No Stops
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* RIGHT COLUMN: New Analytics Widget */}
                <div className="lg:col-span-5">
                    <DriverAnalyticsWidget analytics={driver.analytics} driver={driver} />
                </div>
            </div>

            <TyreHistoryWidget driver={driver} />


            {((driver.pit_stops && driver.pit_stops.length > 0) || (driver.stints && driver.stints.length > 1)) && (
                <div className="flex items-start gap-4 pt-4 border-t border-gray-800">
                    <span className="font-bold text-gray-400 w-12 text-xs uppercase tracking-wider mt-1">Pits:</span>
                    <div className="flex flex-wrap gap-2">
                        {driver.pit_stops && driver.pit_stops.length > 0 ? (
                            // 1. Show actual pit stops if the API provided them
                            driver.pit_stops.map((p: any, i: number) => (
                                <div key={i} className="bg-gray-800 border border-gray-700 font-mono px-3 py-1.5 rounded flex flex-col gap-0.5 min-w-[100px]">
                                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Lap {p.lap}</span>
                                    {p.stop_duration && <span>Box: <strong className="text-white">{p.stop_duration.toFixed(2)}s</strong></span>}
                                    {p.lane_duration && <span>Lane: <strong className="text-gray-200">{p.lane_duration.toFixed(2)}s</strong></span>}
                                    {(!p.stop_duration && !p.lane_duration && p.pit_duration) && <span>Time: <strong className="text-white">{p.pit_duration.toFixed(2)}s</strong></span>}
                                </div>
                            ))
                        ) : (
                            // 2. Infer pit stops from tyre changes if API data is empty
                            driver.stints.slice(1).map((s: any, i: number) => (
                                <div key={`inferred-${i}`} className="bg-gray-800 border border-gray-700 font-mono px-3 py-1.5 rounded flex flex-col gap-0.5 min-w-[100px] justify-center">
                                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Lap {s.start}</span>
                                    <span className="text-gray-500 italic text-[9px]">*Duration N/A</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
});

export const TyreHistoryWidget = ({ driver }: { driver: any }) => (
    <div className="flex items-center gap-4 pt-6 pb-8">
        <span className="font-bold text-gray-400 w-12 text-xs uppercase tracking-wider">Tyres:</span>
        <div className="flex-1 flex items-center relative h-2.5 bg-gray-800 rounded-full">
            {driver && driver.tyreHistory && driver.tyreHistory.stints.map((stint: any, i: number) => {
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
                                <span className="absolute top-4 text-[10px] font-bold font-mono text-gray-200 bg-gray-900 px-1.5 py-0.5 rounded border border-gray-700 shadow-md">
                                    {`L${stint.start > 1 ? stint.start - 1 : stint.stat}`}
                                </span>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    </div>
);

export const PitHistoryWidget = ({ driver }: { driver: any }) => {
    if (!((driver && driver.tyreHistory && driver.tyreHistory.pit_stops && driver.tyreHistory.pit_stops.length > 0) || (driver.tyreHistory.stints && driver.tyreHistory.stints.length > 1))) return null;
    return (
        <div className="flex items-start gap-4 pt-4 border-t border-gray-800">
            <span className="font-bold text-gray-400 w-12 text-xs uppercase tracking-wider mt-1">Pits:</span>
            <div className="flex flex-wrap gap-2">
                {driver.tyreHistory.pit_stops && driver.tyreHistory.pit_stops.length > 0 ? (
                    driver.tyreHistory.pit_stops.map((p: any, i: number) => (
                        <div key={i} className="bg-gray-800 border border-gray-700 font-mono px-3 py-1.5 rounded flex flex-col gap-0.5 min-w-[100px]">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Lap {p.lap}</span>
                            {p.stop_duration && <span>Box: <strong className="text-white">{p.stop_duration.toFixed(2)}s</strong></span>}
                            {p.lane_duration && <span>Lane: <strong className="text-gray-200">{p.lane_duration.toFixed(2)}s</strong></span>}
                            {(!p.stop_duration && !p.lane_duration && p.pit_duration) && <span>Time: <strong className="text-white">{p.pit_duration.toFixed(2)}s</strong></span>}
                        </div>
                    ))
                ) : (
                    driver.tyreHistory.stints.slice(1).map((s: any, i: number) => (
                        <div key={`inferred-${i}`} className="bg-gray-800 border border-gray-700 font-mono px-3 py-1.5 rounded flex flex-col gap-0.5 min-w-[100px] justify-center">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Lap {s.start}</span>
                            <span className="text-gray-500 italic text-[9px]">*Duration N/A</span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export const AllDriversPaceChart = ({ activeResults, currentDriverNumber, maxRaceLap }: { activeResults: any[], currentDriverNumber: number, maxRaceLap: number }) => {
    const chartRef = useRef<HTMLDivElement>(null);
    const plotInstance = useRef<uPlot | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const [hiddenDrivers, setHiddenDrivers] = useState<Set<number>>(new Set());
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");

    const toggleDriver = (dNum: number) => {
        setHiddenDrivers(prev => {
            const next = new Set(prev);
            if (next.has(dNum)) next.delete(dNum);
            else next.add(dNum);
            return next;
        });
    };

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useLayoutEffect(() => {
        if (!chartRef.current || !activeResults || activeResults.length === 0) return;

        const maxLaps = Math.max(maxRaceLap, ...activeResults.map(d => d.lapsHistory?.length || 0));
        if (maxLaps === 0) return;

        const xLaps = Array.from({length: maxLaps}, (_, i) => i + 1);
        const seriesData: (number | null)[][] = [xLaps];
        const seriesConfig: uPlot.Series[] = [
            { label: "Lap" }
        ];

        // Sort so the current driver's line renders last (on top)
        const sortedResults = [...activeResults].sort((a, b) => {
            if (a.driver_number === currentDriverNumber) return 1;
            if (b.driver_number === currentDriverNumber) return -1;
            return 0;
        });

        sortedResults.forEach(driver => {
            if (!driver.lapsHistory) return;
            const yData = xLaps.map(lapNum => {
                const lap = driver.lapsHistory.find((l: any) => l.lap_number === lapNum);
                return lap && lap.position && lap.position !== 99 ? lap.position : null;
            });
            seriesData.push(yData);

            const isCurrent = driver.driver_number === currentDriverNumber;
            seriesConfig.push({
                show: !hiddenDrivers.has(driver.driver_number), 
                label: driver.name || String(driver.driver_number),
                stroke: `#${driver.team_color || 'ffffff'}`,
                width: isCurrent ? 3 : 1.5,
                points: { show: true, size: isCurrent ? 5 : 3.5, fill: `#${driver.team_color || 'ffffff'}` },
                spanGaps: true,
                value: (u, v) => v == null ? '--' : `P${v}`
            });
        });

        const opts: uPlot.Options = {
            width: chartRef.current.clientWidth || 800,
            height: 450,
            legend: { show: false }, 
            cursor: { x: true, y: true, sync: { key: 'lapSync' } },
            axes: [
                { 
                    stroke: "#64748b", 
                    grid: { stroke: "#334155", width: 1 }, 
                    label: "LAP", 
                    labelSize: 20 
                },
                { 
                    stroke: "#64748b", 
                    grid: { stroke: "#334155", width: 1 }, 
                    space: 40,
                    label: "POSITION",
                    labelSize: 30,
                    values: (u, vals) => vals.map(v => v == null ? '' : `P${v}`)
                }
            ],
            series: seriesConfig,
            scales: {
                x: { time: false },
                y: { 
                    dir: -1, 
                    auto: true
                }
            }
        };

        plotInstance.current = new uPlot(opts, seriesData as uPlot.AlignedData, chartRef.current);

        return () => plotInstance.current?.destroy();
    }, [activeResults, currentDriverNumber, maxRaceLap, hiddenDrivers]);

    const filteredDrivers = activeResults.filter(d => 
        (d.name || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
        String(d.driver_number).includes(searchQuery)
    );

    return (
        <div className="flex flex-col h-full w-full min-h-0 relative">
            {/* Header Controls */}
            <div className="flex items-center justify-between mb-2 border-b border-gray-700/60 pb-2 border-dashed shrink-0 relative z-20">
                <span className="text-gray-300 font-bold uppercase tracking-widest text-sm">POSITION HISTORY</span>
                
                <div className="flex items-center gap-3">
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest hidden sm:block">Drivers</span>
                    <div className="relative" ref={dropdownRef}>
                        <button 
                            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                            className="bg-gray-800 border border-gray-700 hover:bg-gray-700 text-gray-300 text-xs px-3 py-1.5 rounded flex items-center justify-between min-w-[220px] transition-colors shadow-inner"
                        >
                            <span className="font-bold uppercase tracking-widest text-[10px]">Select Drivers... ({activeResults.length - hiddenDrivers.size}/{activeResults.length})</span>
                            <span className="text-gray-500 ml-2 text-[10px]">{isDropdownOpen ? '▲' : '▼'}</span>
                        </button>
                        
                        {isDropdownOpen && (
                            <div className="absolute top-full mt-2 right-0 w-[260px] bg-gray-800 border border-gray-700 rounded-md shadow-2xl z-50 flex flex-col max-h-[300px]">
                                <div className="p-2 border-b border-gray-700">
                                    <input 
                                        type="text" 
                                        placeholder="Search driver by name or #..." 
                                        value={searchQuery}
                                        onChange={e => setSearchQuery(e.target.value)}
                                        className="w-full bg-gray-900 border border-gray-700 text-gray-200 text-xs font-mono rounded px-3 py-2 outline-none focus:border-blue-500 transition-colors placeholder-gray-600"
                                    />
                                </div>
                                <div className="flex justify-between p-2 border-b border-gray-700 bg-gray-900/50">
                                    <button onClick={() => setHiddenDrivers(new Set())} className="text-[10px] uppercase tracking-widest text-blue-400 hover:text-blue-300 font-bold transition-colors">Select All</button>
                                    <button onClick={() => setHiddenDrivers(new Set(activeResults.map(d => d.driver_number)))} className="text-[10px] uppercase tracking-widest text-red-400 hover:text-red-300 font-bold transition-colors">Deselect All</button>
                                </div>
                                <div className="overflow-y-auto custom-scrollbar p-1.5 flex-1">
                                    {filteredDrivers.map(driver => {
                                        const isVisible = !hiddenDrivers.has(driver.driver_number);
                                        return (
                                            <div 
                                                key={driver.driver_number}
                                                onClick={() => toggleDriver(driver.driver_number)}
                                                className="flex items-center gap-3 px-2 py-1.5 hover:bg-gray-700 rounded cursor-pointer transition-colors"
                                            >
                                                <input 
                                                    type="checkbox" 
                                                    checked={isVisible}
                                                    readOnly
                                                    className="w-3.5 h-3.5 accent-blue-500 cursor-pointer rounded-sm"
                                                />
                                                <div className="w-2.5 h-2.5 rounded-sm border border-gray-900" style={{ backgroundColor: `#${driver.team_color}` }}></div>
                                                <span className="text-xs text-gray-200 font-bold uppercase tracking-wider">{driver.name}</span>
                                                <span className="text-[10px] font-mono text-gray-500 ml-auto font-bold">#{driver.driver_number}</span>
                                            </div>
                                        );
                                    })}
                                    {filteredDrivers.length === 0 && (
                                        <div className="p-4 text-center text-xs text-gray-500 font-bold uppercase tracking-widest">No drivers found</div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* uPlot Chart */}
            <div ref={chartRef} className="w-full flex-1 min-h-0" style={{ minHeight: '300px' }}></div>
        </div>
    );
};