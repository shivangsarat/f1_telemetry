import React, { useState } from 'react';
import { getFlagTheme, getTyreColor } from '../Utils/helpers';
import { SectorBlock } from './TelemetryWidgets';

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

export const RaceControlWidget = React.memo(({ messages }: { messages: any[] }) => {
    const [expanded, setExpanded] = useState(false);
    return (
        <div className={`fixed bottom-6 right-6 z-[60] bg-gray-900 border ${expanded ? 'border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.2)]' : 'border-gray-700'} rounded-xl transition-all duration-300 flex flex-col`} style={{ width: '380px', maxHeight: '500px' }}>
            <button onClick={() => setExpanded(!expanded)} className="p-3 font-bold uppercase text-xs tracking-widest text-left flex justify-between items-center bg-gray-800 rounded-t-xl text-red-400 hover:bg-gray-700 transition">
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
    );
});

export const DriverExpandedRow = React.memo(({ driver, isLive, isRaceMode }: { driver: any, isLive: boolean, isRaceMode: boolean }) => {
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
});