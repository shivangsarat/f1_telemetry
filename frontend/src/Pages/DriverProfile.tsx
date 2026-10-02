import { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useDriverTelemetry } from '../Hooks/useDriverTelemetry';
import { useRaceStore } from '../store/useRaceStore';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

const VIEWPORT_LAPS = 3;

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

export const DriverProfile = () => {
    const { sessionKey, driverId } = useParams();
    const driverNumber = Number(driverId);
    const isLive = sessionKey === 'live';
    
    const connect = useRaceStore(state => state.connect);
    useEffect(() => { if (isLive) connect(); }, [isLive, connect]);
    
    const liveData = useDriverTelemetry(driverNumber, isLive); 

    const [histPayload, setHistPayload] = useState<{telemetry: any[], laps: any[], stints: any[]}>({ telemetry: [], laps: [], stints: [] });
    const [loading, setLoading] = useState(!isLive);

    const [isAutoScroll, setIsAutoScroll] = useState(isLive);
    const [manualMin, setManualMin] = useState(0);
    const [maxLapX, setMaxLapX] = useState(VIEWPORT_LAPS);

    const chartRef1 = useRef<HTMLDivElement>(null);
    const chartRef2 = useRef<HTMLDivElement>(null);
    const plotInstance1 = useRef<uPlot | null>(null);
    const plotInstance2 = useRef<uPlot | null>(null);

    useEffect(() => {
        setHistPayload({ telemetry: [], laps: [], stints: [] });
        setManualMin(0);

        if (!isLive) {
            setLoading(true);
            fetch(`http://localhost:8080/api/telemetry/${sessionKey}/${driverNumber}`)
                .then(r => r.json())
                .then(cleanData => {
                    setHistPayload(cleanData);
                    setLoading(false);
                })
                .catch(() => setLoading(false));
        } else {
            setLoading(false);
        }
    }, [isLive, sessionKey, driverNumber]);

    const activeData = isLive ? liveData : histPayload;
    const processedData = activeData.telemetry;

    useLayoutEffect(() => {
        if (!chartRef1.current || !chartRef2.current) return;
        const width = chartRef1.current.clientWidth || 800;

        plotInstance1.current = new uPlot({
            width: width, height: 300,
            axes: [{ stroke: "#ccc" }, { stroke: "#00ff00", scale: "speed" }, { side: 1, stroke: "#ff00ff", grid: { show: false }, scale: "rpm" }],
            series: [{}, { label: "Speed", stroke: "#00ff00", scale: "speed" }, { label: "RPM", stroke: "#ff00ff", scale: "rpm" }],
            scales: { x: { time: false, auto: false }, speed: { auto: true }, rpm: { auto: true } } 
        }, [[], [], []], chartRef1.current);

        plotInstance2.current = new uPlot({
            width: width, height: 250,
            axes: [{ stroke: "#ccc" }, { stroke: "#00aaff", scale: "pct" }, { side: 1, stroke: "#ffaa00", grid: { show: false }, scale: "gear" }],
            series: [{}, { label: "Throttle", stroke: "#00aaff", scale: "pct" }, { label: "Brake", stroke: "#ff3333", scale: "pct" }, { label: "Gear", stroke: "#ffaa00", scale: "gear" }],
            scales: { x: { time: false, auto: false }, pct: { min: 0, max: 105 }, gear: { min: 0, max: 9 } }
        }, [[], [], [], []], chartRef2.current);

        return () => { plotInstance1.current?.destroy(); plotInstance2.current?.destroy(); };
    }, []);

    useEffect(() => {
        if (processedData.length > 0) {
            const xLaps = processedData.map(d => d.lapX);
            setMaxLapX(xLaps[xLaps.length - 1]); 
            if (!isLive && manualMin === 0) setManualMin(Math.floor(xLaps[0]));
            
            plotInstance1.current?.setData([xLaps, processedData.map(d => d.speed), processedData.map(d => d.rpm)]);
            plotInstance2.current?.setData([xLaps, processedData.map(d => d.throttle), processedData.map(d => d.brake), processedData.map(d => d.gear)]);
        }
    }, [processedData, isLive, manualMin]);

    useEffect(() => {
        let min = manualMin;
        let max = manualMin + VIEWPORT_LAPS;

        if (isAutoScroll) {
            if (maxLapX < VIEWPORT_LAPS * 0.75) {
                min = 0; max = VIEWPORT_LAPS;
            } else {
                max = maxLapX + (VIEWPORT_LAPS * 0.25);
                min = max - VIEWPORT_LAPS;
            }
        }
        plotInstance1.current?.setScale('x', { min, max });
        plotInstance2.current?.setScale('x', { min, max });
    }, [maxLapX, isAutoScroll, manualMin]);

    const maxAllowedScroll = Math.max(0, maxLapX + (VIEWPORT_LAPS * 0.25) - VIEWPORT_LAPS);
    const currentSliderVal = isAutoScroll ? maxAllowedScroll : manualMin;

    // --- Dynamic Lap Matching Logic ---
    // Finds the lap data associated with the current timeline slider position
    const activeLapNumber = Math.max(1, Math.floor(currentSliderVal));
    const activeLapData = activeData.laps?.find((l: any) => l.lap_number === activeLapNumber) || null;
    const activeStint = activeData.stints?.find((s: any) => s.lap_start <= activeLapNumber && (s.lap_end >= activeLapNumber || s.lap_end === 0)) || null;

    return (
        <div className="p-6 bg-black text-white min-h-screen flex flex-col gap-6">
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-6">
                    <h1 className="text-3xl font-bold">Driver {driverNumber} Telemetry</h1>
                    {!isAutoScroll && (
                        <button onClick={() => setIsAutoScroll(true)} className="bg-blue-600 hover:bg-blue-500 text-white text-xs px-4 py-1.5 rounded-full font-bold uppercase transition">
                            Resume Auto-Scroll →
                        </button>
                    )}
                </div>
                <Link to={`/race/${sessionKey}`} className="text-gray-400 hover:text-white uppercase font-bold text-sm">
                    ← Back to Results
                </Link>
            </div>
            
            <div className="flex flex-col gap-6 relative">
                {loading && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-900/80 backdrop-blur-sm rounded-xl border border-gray-800">
                        <span className="text-gray-300 font-bold uppercase tracking-widest animate-pulse">Processing Backend Telemetry...</span>
                    </div>
                )}

                <div className="bg-gray-900 p-5 rounded-xl border border-gray-800 relative">
                    <h2 className="text-sm text-gray-400 uppercase tracking-wider mb-4 flex justify-between">
                        <span>Speed & Engine RPM</span>
                        {isAutoScroll && isLive && <span className="text-green-500 animate-pulse font-bold">● LIVE</span>}
                    </h2>
                    <div ref={chartRef1} className="w-full min-h-[300px]"></div>
                </div>
                
                <div className="bg-gray-900 p-5 rounded-xl border border-gray-800">
                    <h2 className="text-sm text-gray-400 uppercase tracking-wider mb-4">Driver Inputs & Gear</h2>
                    <div ref={chartRef2} className="w-full min-h-[250px]"></div>
                </div>

                {/* --- Timeline & Dynamic Lap Summary --- */}
                <div className="bg-gray-900 p-5 rounded-xl border border-gray-800 flex flex-col gap-6">
                    
                    {/* Slider */}
                    <div className="flex items-center gap-4">
                        <span className="text-xs text-gray-500 uppercase font-bold w-20">Timeline</span>
                        <input 
                            type="range" min={0} max={maxAllowedScroll} step={0.1} value={currentSliderVal}
                            onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                setManualMin(val);
                                setIsAutoScroll(val >= maxAllowedScroll - 0.2);
                            }}
                            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                        />
                        <span className="text-xs text-gray-400 w-24 text-right">Lap {currentSliderVal.toFixed(1)}</span>
                    </div>

                    {/* Dynamic Lap Stats Panel */}
                    <div className="flex flex-wrap items-center justify-between border-t border-gray-800 pt-4 px-4 bg-gray-800/20 rounded-lg mt-2">
                        <div className="flex items-center gap-4">
                            <span className="text-sm font-bold text-gray-400">LAP {activeLapNumber} INFO</span>
                            {activeStint && (
                                <div className="flex items-center gap-2 bg-gray-800 px-3 py-1 rounded-full border border-gray-700">
                                    <div className="w-3 h-3 rounded-full border border-gray-500" style={{ backgroundColor: getTyreColor(activeStint.compound) }}></div>
                                    <span className="text-xs font-bold text-gray-300 tracking-widest">{activeStint.compound}</span>
                                </div>
                            )}
                        </div>

                        {activeLapData ? (
                            <div className="flex gap-8 font-mono text-gray-400 text-xs">
                                <div className="w-20">
                                    <span>S1: <strong className="text-gray-200">{activeLapData.duration_sector_1 ? `${activeLapData.duration_sector_1.toFixed(3)}s` : '-'}</strong></span>
                                    {renderMinisectors(activeLapData.segments_sector_1)}
                                </div>
                                <div className="w-20">
                                    <span>S2: <strong className="text-gray-200">{activeLapData.duration_sector_2 ? `${activeLapData.duration_sector_2.toFixed(3)}s` : '-'}</strong></span>
                                    {renderMinisectors(activeLapData.segments_sector_2)}
                                </div>
                                <div className="w-20">
                                    <span>S3: <strong className="text-gray-200">{activeLapData.duration_sector_3 ? `${activeLapData.duration_sector_3.toFixed(3)}s` : '-'}</strong></span>
                                    {renderMinisectors(activeLapData.segments_sector_3)}
                                </div>
                            </div>
                        ) : (
                            <span className="text-xs text-gray-600 italic">Sector data unavailable for this lap</span>
                        )}
                    </div>

                </div>
            </div>
        </div>
    );
};