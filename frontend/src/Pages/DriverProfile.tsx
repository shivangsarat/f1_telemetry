import { useEffect, useRef, useState, useLayoutEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useDriverTelemetry } from '../Hooks/useDriverTelemetry';
import { useRaceStore } from '../store/useRaceStore';
import { DriverChampionshipWidget, DriverAnalyticsWidget, TyreHistoryWidget, PitHistoryWidget, AllDriversPaceChart, AllDriversLapTimesChart } from '../Components/DashboardWidgets';
import { SectorBlock } from '../Components/TelemetryWidgets';
import { LiveTrackerWidget } from '../Components/LiveTrackMap';
import { DriverBadges } from '../Components/DriverBadges';
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

const formatLapTime = (seconds: number | null) => {
    if (!seconds || isNaN(seconds) || seconds === Infinity) return '-';
    const m = Math.floor(seconds / 60);
    const s = (seconds % 60).toFixed(3);
    return m > 0 ? `${m}:${s.padStart(6, '0')}` : `${s}s`;
};

export const DriverProfile = () => {
    const { sessionKey, driverId } = useParams();
    const driverNumber = Number(driverId);
    
    const isLive = sessionKey === 'live' || sessionKey === 'latest';
    
    const connect = useRaceStore(state => state.connect);
    const liveRace = useRaceStore(state => state.liveRace);
    const cacheHistoricalRace = useRaceStore(state => state.cacheHistoricalRace);
    const cacheHistoricalDriver = useRaceStore(state => state.cacheHistoricalDriver);
    useEffect(() => { if (isLive) connect(); }, [isLive, connect]);
    
    const liveData = useDriverTelemetry(driverNumber, isLive); 

    const historicalCacheKey = `${sessionKey || ''}:${driverNumber}`;
    const cachedHistoricalPayload = useRaceStore(state => state.historicalDrivers[historicalCacheKey]);
    const cachedRaceDetails = useRaceStore(state => sessionKey ? state.historicalRaces[String(sessionKey)] : undefined);

    const [histPayload, setHistPayload] = useState<{telemetry: any[], laps: any[], stints: any[]}>(() => (
        cachedHistoricalPayload || { telemetry: [], laps: [], stints: [] }
    ));
    const [raceDetails, setRaceDetails] = useState<any>(() => cachedRaceDetails || null);
    const [loading, setLoading] = useState(false);

    const [isAutoScroll, setIsAutoScroll] = useState(true);
    const [manualMin, setManualMin] = useState(0);
    const [maxLapX, setMaxLapX] = useState(0);

    const chartRef1 = useRef<HTMLDivElement>(null);
    const chartRef2 = useRef<HTMLDivElement>(null);
    const plotInstance1 = useRef<uPlot | null>(null);
    const plotInstance2 = useRef<uPlot | null>(null);

    const lapXRef1 = useRef<HTMLSpanElement>(null);
    const speedRef = useRef<HTMLSpanElement>(null);
    const rpmRef = useRef<HTMLSpanElement>(null);
    const lapXRef2 = useRef<HTMLSpanElement>(null);
    const throttleRef = useRef<HTMLSpanElement>(null);
    const brakeRef = useRef<HTMLSpanElement>(null);
    const gearRef = useRef<HTMLSpanElement>(null);

    const processedData = (isLive ? liveData : histPayload).telemetry;
    const processedDataRef = useRef(processedData);
    useEffect(() => { processedDataRef.current = processedData; }, [processedData]);

    const [legendValues, setLegendValues] = useState({ lapX: '--', speed: '--', rpm: '--', throttle: '--', brake: '--', gear: '--', drs: '--' });

    const updateLegendState = useCallback((d: any) => {
        if (!d) return;
        setLegendValues({
            lapX: d.lapX.toFixed(3),
            speed: d.speed ?? '--',
            rpm: d.rpm ?? '--',
            throttle: d.throttle ?? '--',
            brake: d.brake ?? '--',
            gear: d.gear ?? '--',
            drs: d.drs ?? '--'
        });
    }, []);

    useLayoutEffect(() => {
        if (!chartRef1.current || !chartRef2.current) return;
        const width = chartRef1.current.clientWidth || 800;

        const syncLegendHook = (u: uPlot) => {
            const idx = u.cursor.idx;
            if (idx != null && processedDataRef.current[idx]) {
                const d = processedDataRef.current[idx];
                updateLegendState(d);
                if (lapXRef1.current) lapXRef1.current.textContent = d.lapX.toFixed(3);
                if (speedRef.current) speedRef.current.textContent = String(d.speed);
                if (rpmRef.current) rpmRef.current.textContent = String(d.rpm);
                
                if (lapXRef2.current) lapXRef2.current.textContent = d.lapX.toFixed(3);
                if (throttleRef.current) throttleRef.current.textContent = String(d.throttle);
                if (brakeRef.current) brakeRef.current.textContent = String(d.brake);
                if (gearRef.current) gearRef.current.textContent = String(d.gear);
            }
        };

        plotInstance1.current = new uPlot({
            width, height: 300,
            legend: { show: false },
            cursor: { x: true, y: false, sync: { key: 'telemetry' } },
            axes: [{ stroke: "#ccc" }, { stroke: "#00ff00", scale: "speed" }, { side: 1, stroke: "#ff00ff", grid: { show: false }, scale: "rpm" }],
            series: [{}, { label: "Speed", stroke: "#00ff00", scale: "speed" }, { label: "RPM", stroke: "#ff00ff", scale: "rpm" }],
            scales: { x: { time: false, auto: false }, speed: { auto: true }, rpm: { auto: true } },
            hooks: { setCursor: [syncLegendHook] }
        }, [[], [], []], chartRef1.current);

        plotInstance2.current = new uPlot({
            width, height: 250,
            legend: { show: false },
            cursor: { x: true, y: false, sync: { key: 'telemetry' } },
            axes: [{ stroke: "#ccc" }, { stroke: "#00aaff", scale: "pct" }, { side: 1, stroke: "#ffaa00", grid: { show: false }, scale: "gear" }],
            series: [{}, { label: "Throttle", stroke: "#00aaff", scale: "pct" }, { label: "Brake", stroke: "#ff3333", scale: "pct" }, { label: "Gear", stroke: "#ffaa00", scale: "gear" }],
            scales: { x: { time: false, auto: false }, pct: { min: 0, max: 105 }, gear: { min: 0, max: 9 } },
            hooks: { setCursor: [syncLegendHook] }
        }, [[], [], [], []], chartRef2.current);

        return () => { plotInstance1.current?.destroy(); plotInstance2.current?.destroy(); };
    }, [updateLegendState]);

    useEffect(() => {
        if (isLive) {
            setLoading(false);
            return;
        }

        const key = String(sessionKey || '');
        if (!key || !Number.isFinite(driverNumber)) return;

        const state = useRaceStore.getState();
        const telemetryKey = `${key}:${driverNumber}`;
        const cachedTelemetry = state.historicalDrivers[telemetryKey];
        const cachedRace = state.historicalRaces[key];

        if (cachedTelemetry) setHistPayload(cachedTelemetry);
        if (cachedRace) setRaceDetails(cachedRace);

        const needsTelemetry = !cachedTelemetry;
        const needsRace = !cachedRace;

        if (!needsTelemetry && !needsRace) {
            setLoading(false);
            return;
        }

        const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:8080';
        setLoading(true);

        Promise.all([
            needsTelemetry
                ? fetch(`${API_BASE}/api/telemetry/${key}/${driverNumber}`).then(r => r.json())
                : Promise.resolve(cachedTelemetry),
            needsRace
                ? fetch(`${API_BASE}/api/race-details/${key}`).then(r => r.json())
                : Promise.resolve(cachedRace)
        ]).then(([cleanData, rd]) => {
            if (needsTelemetry && cleanData) cacheHistoricalDriver(key, driverNumber, cleanData);
            if (needsRace && rd) cacheHistoricalRace(key, rd);

            if (cleanData) setHistPayload(cleanData);
            if (rd) setRaceDetails(rd);
            setLoading(false);
        }).catch(() => setLoading(false));
    }, [sessionKey, driverNumber, isLive, cacheHistoricalDriver, cacheHistoricalRace]);

    const snapToPlayhead = useCallback(() => {
        if (!plotInstance1.current || !plotInstance2.current || processedDataRef.current.length === 0) return;
        const targetX = isAutoScroll ? maxLapX : manualMin + (VIEWPORT_LAPS * 0.75);
        const leftPx = plotInstance1.current.valToPos(targetX, 'x');
        
        plotInstance1.current.setCursor({ left: leftPx, top: -10 });
        plotInstance2.current.setCursor({ left: leftPx, top: -10 });
        
        const closest = processedDataRef.current.reduce((prev, curr) => 
            Math.abs(curr.lapX - targetX) < Math.abs(prev.lapX - targetX) ? curr : prev
        , processedDataRef.current[0]);
        
        updateLegendState(closest);
    }, [isAutoScroll, maxLapX, manualMin, updateLegendState]);

    useEffect(() => {
        if (processedData.length > 0) {
            const xLaps = processedData.map((d: any) => d.lapX);
            const latestX = xLaps[xLaps.length - 1];
            setMaxLapX(latestX); 
            
            plotInstance1.current?.setData([xLaps, processedData.map((d: any) => d.speed), processedData.map((d: any) => d.rpm)]);
            plotInstance2.current?.setData([xLaps, processedData.map((d: any) => d.throttle), processedData.map((d: any) => d.brake), processedData.map((d: any) => d.gear)]);
        }
    }, [processedData]);

    useEffect(() => {
        let min = 0;
        let max = VIEWPORT_LAPS;

        if (maxLapX <= VIEWPORT_LAPS) {
            min = 0;
            max = VIEWPORT_LAPS;
        } else if (isAutoScroll) {
            const targetOffset = VIEWPORT_LAPS * 0.75;
            max = maxLapX + (VIEWPORT_LAPS - targetOffset);
            min = max - VIEWPORT_LAPS;
        } else {
            min = manualMin;
            max = manualMin + VIEWPORT_LAPS;
        }

        plotInstance1.current?.setScale('x', { min, max });
        plotInstance2.current?.setScale('x', { min, max });

        snapToPlayhead();
    }, [maxLapX, isAutoScroll, manualMin, snapToPlayhead]);

    const maxAllowedScroll = Math.max(0, maxLapX + (VIEWPORT_LAPS * 0.25) - VIEWPORT_LAPS);
    const currentSliderVal = isAutoScroll ? maxAllowedScroll : manualMin;
    const hasEnoughDataToScroll = maxLapX > VIEWPORT_LAPS;

    
    const activeResults = isLive ? (liveRace?.results || []) : (raceDetails?.results || []);
    const isRaceMode = isLive ? Boolean(liveRace?.isRace) : Boolean(raceDetails?.isRace);
    const activeSessionInfo = isLive ? liveRace?.sessionInfo : raceDetails?.sessionInfo;
    const activeMeetingInfo = isLive ? liveRace?.meetingInfo : raceDetails?.meetingInfo;
    const raceName =
        activeMeetingInfo?.meeting_name
        || activeSessionInfo?.meeting_name
        || (activeSessionInfo?.location ? `${activeSessionInfo.location} Grand Prix` : 'Grand Prix');
    const activeSessionName = activeSessionInfo?.session_name || activeSessionInfo?.session_type || '';

    const currentDriverInfo = activeResults.find((d: any) => Number(d.driver_number) === driverNumber);
    const deletedLapByNumber = new Map<number, any>(
        (currentDriverInfo?.lapsHistory || [])
            .filter((lap: any) => lap?.is_deleted)
            .map((lap: any) => [Number(lap.lap_number), lap])
    );

    const activeData = isLive ? liveData : histPayload;
    const activeLapNumber = Math.max(1, Math.floor(currentSliderVal));

    const latestTelemetry = processedData.length > 0 ? processedData[processedData.length - 1] : null;
    const currentLiveLapObj = activeData.laps?.length > 0 ? activeData.laps[activeData.laps.length - 1] : null;
    const completedLaps = (activeData.laps || []).filter((l: any) => typeof l.lap_duration === 'number' && l.lap_duration > 0);
    const validCompletedLaps = completedLaps.filter((lap: any) => !deletedLapByNumber.has(Number(lap.lap_number)));
    const bestLapObj = validCompletedLaps.length > 0
        ? validCompletedLaps.reduce((min: any, l: any) => l.lap_duration < min.lap_duration ? l : min, validCompletedLaps[0])
        : null;
    const sessionBests = isLive ? liveRace?.sessionBests : raceDetails?.sessionBests;

    const liveLapProgress = latestTelemetry && Number.isFinite(Number(latestTelemetry.lapX))
        ? Math.max(0, Math.min(0.999, Number(latestTelemetry.lapX) - Math.floor(Number(latestTelemetry.lapX))))
        : 0;

    const pbSectorTimes = bestLapObj ? [
        Number(bestLapObj.duration_sector_1) || 0,
        Number(bestLapObj.duration_sector_2) || 0,
        Number(bestLapObj.duration_sector_3) || 0
    ] : [0, 0, 0];

    const currentSectorTimes = currentLiveLapObj ? [
        Number(currentLiveLapObj.duration_sector_1) || 0,
        Number(currentLiveLapObj.duration_sector_2) || 0,
        Number(currentLiveLapObj.duration_sector_3) || 0
    ] : [0, 0, 0];

    const completedSectorCount = currentSectorTimes.reduce((count, value) => count + (value > 0 ? 1 : 0), 0);
    const comparableCurrentSectorTime = currentSectorTimes
        .slice(0, completedSectorCount)
        .reduce((sum, value) => sum + value, 0);
    const comparablePbSectorTime = pbSectorTimes
        .slice(0, completedSectorCount)
        .reduce((sum, value) => sum + value, 0);

    const liveDeltaToPb = completedSectorCount > 0 && comparablePbSectorTime > 0
        ? comparableCurrentSectorTime - comparablePbSectorTime
        : null;

    const projectedLapTime = bestLapObj && liveDeltaToPb !== null
        ? Number(bestLapObj.lap_duration) + liveDeltaToPb
        : null;
    const isSessionBestLap = (value: any) => {
        const lap = Number(value);
        const best = Number(sessionBests?.lap?.raw);
        return Number.isFinite(lap) && Number.isFinite(best) && Math.abs(lap - best) < 0.0005;
    };
    const personalBestSectors = validCompletedLaps.reduce((best: any, lap: any) => ({
        s1: Math.min(best.s1, Number(lap.duration_sector_1) || Infinity),
        s2: Math.min(best.s2, Number(lap.duration_sector_2) || Infinity),
        s3: Math.min(best.s3, Number(lap.duration_sector_3) || Infinity),
    }), { s1: Infinity, s2: Infinity, s3: Infinity });
    const isPersonalBestSector = (value: any, key: 's1' | 's2' | 's3') => {
        const n = Number(value);
        return Number.isFinite(n) && Math.abs(n - personalBestSectors[key]) < 0.0005;
    };
    const isSessionBestSector = (value: any, key: 's1' | 's2' | 's3') => {
        const n = Number(value);
        const best = Number(sessionBests?.[key]?.raw);
        return Number.isFinite(n) && Number.isFinite(best) && Math.abs(n - best) < 0.0005;
    };

    const isLiveTracking = isAutoScroll && isLive;

    return (
        <div className="p-6 bg-black text-white min-h-screen flex flex-col gap-6">

            <div className="flex justify-between items-start gap-6 flex-wrap">
                <div className="flex flex-col gap-2 min-w-0">
                    <div className="flex items-center gap-2">
                        {isLive && <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0" />}
                        <span className={`text-xs font-black uppercase tracking-[0.16em] ${isLive ? 'text-green-400' : 'text-blue-400'}`}>
                            {raceName}
                        </span>
                        {activeSessionName && (
                            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-600">
                                · {activeSessionName}
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-6 flex-wrap">
                        <div className="flex items-center gap-3 flex-wrap">
                            <h1 className="text-3xl font-bold">
                                {currentDriverInfo?.name || 'Driver'} <span className="text-gray-400">#{driverNumber}</span> Telemetry
                            </h1>
                            {currentDriverInfo && <DriverBadges driver={currentDriverInfo} />}
                        </div>
                        {!isAutoScroll && (
                            <button onClick={() => setIsAutoScroll(true)} className="bg-blue-600 hover:bg-blue-500 text-white text-xs px-4 py-1.5 rounded-full font-bold uppercase transition shadow-lg shadow-blue-900/50">
                                Resume Auto-Scroll →
                            </button>
                        )}
                    </div>
                </div>

                <Link
                    to={`/race/${sessionKey}`}
                    className="text-gray-400 hover:text-white uppercase font-bold text-sm shrink-0"
                >
                    ← Back to Results
                </Link>
            </div>
            
            <div className={`flex flex-col gap-6 relative ${isLiveTracking ? 'live-playhead' : 'hist-playhead'}`}>
                {loading && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-900/80 backdrop-blur-sm rounded-xl border border-gray-800">
                        <span className="text-gray-300 font-bold uppercase tracking-widest animate-pulse">Processing Backend Telemetry...</span>
                    </div>
                )}

                {/* DRIVER INFO WIDGETS */}
                {currentDriverInfo && (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full mb-2">
                        <div className="lg:col-span-5 bg-gray-900 p-5 rounded-xl border border-gray-800 shadow-lg flex flex-col justify-center">
                            <div className="flex gap-12 text-sm h-full items-center">
                                <div className="flex flex-col gap-1">
                                    <div>
                                        <span className="font-bold text-gray-400 block mb-1">Best Lap:</span> 
                                        <span className={`font-mono text-lg font-bold ${isSessionBestLap(currentDriverInfo.best_lap_raw) ? 'text-purple-400' : 'text-white'}`}>{currentDriverInfo.best_lap}</span>
                                    </div>
                                    {(!isRaceMode && currentDriverInfo.best_sectors) && <SectorBlock sectors={currentDriverInfo.best_sectors} sessionBests={sessionBests} />}
                                </div>
                                {(isRaceMode || (isLive && !isRaceMode)) && (
                                    <div className={`flex flex-col gap-1 ${!isRaceMode ? 'border-l border-gray-700/50 pl-8' : ''}`}>
                                        <div>
                                            <span className="font-bold text-gray-400 block mb-1">{isRaceMode ? 'Last Lap:' : 'Current Lap:'}</span> 
                                            <span className={`font-mono text-lg font-bold ${isSessionBestLap(currentLiveLapObj?.lap_duration) ? 'text-purple-400' : 'text-white'}`}>
                                                {(currentDriverInfo.last_lap === '-' && (isLive && !isRaceMode)) ? 'In Progress' : currentDriverInfo.last_lap}
                                            </span>
                                        </div>
                                        {(isRaceMode ? currentDriverInfo.last_sectors : currentDriverInfo.best_sectors) && <SectorBlock sectors={isRaceMode ? currentDriverInfo.last_sectors : currentDriverInfo.best_sectors} sessionBests={sessionBests} />}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="lg:col-span-3 bg-gray-900 p-5 rounded-xl border border-gray-800 shadow-lg">
                            <DriverChampionshipWidget driver={currentDriverInfo} liveStandings={undefined} />
                        </div>

                        <div className="lg:col-span-4 bg-gray-900 p-5 rounded-xl border border-gray-800 shadow-lg">
                            <DriverAnalyticsWidget analytics={currentDriverInfo.analytics} driver={currentDriverInfo} />
                        </div>
                    </div>
                )}

                {/* LIVE COCKPIT UI */}
                {latestTelemetry && (
                    <div className="bg-gray-900 p-5 rounded-xl border border-green-500/30 shadow-[0_0_15px_rgba(34,197,94,0.05)] flex flex-col gap-4">
                        <div className="flex justify-between items-center border-b border-gray-800 pb-2">
                            <h2 className="font-bold uppercase tracking-wider text-green-400 text-xs flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span> Live Cockpit Data
                            </h2>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            
                            <div className="flex flex-col gap-2 border-r border-gray-800 pr-4 justify-center">
                                <div className="flex justify-between items-end">
                                    <span className="text-gray-400 text-xs uppercase tracking-widest font-bold">Current Lap (L{currentLiveLapObj?.lap_number || '-'})</span>
                                </div>
                                <div className="flex gap-6 font-mono text-xs">
                                    <div><span className="text-gray-500">S1:</span> <span className="text-white">{currentLiveLapObj?.duration_sector_1 ? currentLiveLapObj.duration_sector_1.toFixed(3) : '-'}</span></div>
                                    <div><span className="text-gray-500">S2:</span> <span className="text-white">{currentLiveLapObj?.duration_sector_2 ? currentLiveLapObj.duration_sector_2.toFixed(3) : '-'}</span></div>
                                    <div><span className="text-gray-500">S3:</span> <span className="text-white">{currentLiveLapObj?.duration_sector_3 ? currentLiveLapObj.duration_sector_3.toFixed(3) : '-'}</span></div>
                                </div>
                                <div className="mt-2 pt-3 border-t border-gray-800/50 grid grid-cols-3 gap-3">
                                    <div>
                                        <span className="text-gray-500 text-[9px] font-bold uppercase tracking-widest block mb-1">Lap Progress</span>
                                        <span className="font-mono text-white text-base font-black">
                                            {Math.round(liveLapProgress * 100)}%
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-gray-500 text-[9px] font-bold uppercase tracking-widest block mb-1">Delta vs PB</span>
                                        <span className={`font-mono text-base font-black ${
                                            liveDeltaToPb === null
                                                ? 'text-gray-500'
                                                : liveDeltaToPb <= 0
                                                    ? 'text-green-400'
                                                    : 'text-red-400'
                                        }`}>
                                            {liveDeltaToPb === null ? '--' : `${liveDeltaToPb >= 0 ? '+' : ''}${liveDeltaToPb.toFixed(3)}s`}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-gray-500 text-[9px] font-bold uppercase tracking-widest block mb-1">Projected Lap</span>
                                        <span className="font-mono text-white text-base font-black">
                                            {projectedLapTime ? formatLapTime(projectedLapTime) : '--'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="flex flex-col gap-4 justify-center border-r border-gray-800 pr-4">
                                <div className="flex items-end gap-2">
                                    <span className="text-5xl font-black font-mono text-green-400 leading-none">{latestTelemetry.speed}</span>
                                    <span className="text-gray-500 text-sm font-bold uppercase pb-1 tracking-widest">km/h</span>
                                </div>
                                <div className="flex items-end gap-2">
                                    <span className="text-3xl font-black font-mono text-purple-400 leading-none">{latestTelemetry.rpm}</span>
                                    <span className="text-gray-500 text-xs font-bold uppercase pb-0.5 tracking-widest">rpm</span>
                                </div>
                                <div className="grid grid-cols-3 gap-2 pt-1">
                                    <div className="rounded border border-gray-800 bg-gray-950/40 px-2 py-1.5">
                                        <span className="block text-[8px] font-bold text-gray-500 uppercase tracking-widest">Long G</span>
                                        <span className={`font-mono text-sm font-black ${Number(latestTelemetry.longitudinalG || 0) < -0.15 ? 'text-red-400' : Number(latestTelemetry.longitudinalG || 0) > 0.15 ? 'text-green-400' : 'text-gray-300'}`}>
                                            {Number(latestTelemetry.longitudinalG || 0) >= 0 ? '+' : ''}{Number(latestTelemetry.longitudinalG || 0).toFixed(2)} G
                                        </span>
                                    </div>
                                    <div className="rounded border border-gray-800 bg-gray-950/40 px-2 py-1.5">
                                        <span className="block text-[8px] font-bold text-gray-500 uppercase tracking-widest">Lat G</span>
                                        <span className="font-mono text-sm font-black text-blue-300">
                                            {Number(latestTelemetry.lateralG || 0) >= 0 ? '+' : ''}{Number(latestTelemetry.lateralG || 0).toFixed(2)} G
                                        </span>
                                    </div>
                                    <div className="rounded border border-gray-800 bg-gray-950/40 px-2 py-1.5">
                                        <span className="block text-[8px] font-bold text-gray-500 uppercase tracking-widest">Total G</span>
                                        <span className="font-mono text-sm font-black text-white">
                                            {Number(latestTelemetry.totalG || 0).toFixed(2)} G
                                        </span>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="flex flex-col gap-4 justify-center">
                                <div className="flex items-center gap-3">
                                    <span className="w-16 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Throttle</span>
                                    <div className="flex-1 bg-gray-800 h-2.5 rounded-full overflow-hidden border border-gray-700/40">
                                        <div className="bg-blue-500 h-full transition-all duration-75" style={{width: `${Math.min(Math.max(latestTelemetry.throttle, 0), 100)}%`}}></div>
                                    </div>
                                    <span className="w-10 text-right font-mono text-xs text-gray-300 font-bold">{latestTelemetry.throttle}%</span>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-2 mt-1">
                                    <div className={`flex items-center justify-center py-1.5 rounded text-[10px] font-black uppercase tracking-widest transition-all duration-75 border ${latestTelemetry.brake > 5 ? 'bg-red-600 text-white border-red-400 shadow-[0_0_12px_rgba(239,68,68,0.7)] animate-pulse' : 'bg-gray-900/60 text-gray-500 border-gray-800'}`}>
                                        BRAKE
                                    </div>
                                    <div className={`flex items-center justify-center py-1.5 rounded text-[10px] font-black uppercase tracking-widest transition-all duration-75 border ${latestTelemetry.drs >= 10 || latestTelemetry.drs === 1 ? 'bg-emerald-500 text-black border-emerald-300 shadow-[0_0_14px_rgba(16,185,129,0.8)]' : latestTelemetry.drs === 8 ? 'bg-amber-500/20 text-amber-300 border-amber-500/60 shadow-[0_0_8px_rgba(245,158,11,0.3)]' : 'bg-gray-900/60 text-gray-500 border-gray-800'}`}>
                                        {latestTelemetry.drs >= 10 || latestTelemetry.drs === 1 ? 'STRAIGHT MODE' : latestTelemetry.drs === 8 ? 'STRAIGHT AVAIL' : 'STRAIGHT MODE'}
                                    </div>
                                </div>

                                <div className="flex items-center gap-3 mt-1">
                                    <span className="w-16 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Gear</span>
                                    <div className="flex gap-1 flex-1">
                                        {[1,2,3,4,5,6,7,8].map(g => (
                                            <div key={g} className={`flex-1 h-6 flex items-center justify-center rounded text-xs font-bold transition-colors ${latestTelemetry.gear === g ? 'bg-amber-500 text-black shadow-[0_0_8px_rgba(245,158,11,0.6)]' : 'bg-gray-800/50 text-gray-500 border border-gray-700/30'}`}>
                                                {g}
                                            </div>
                                        ))}
                                    </div>
                                    <span className="w-10 text-right font-mono text-xs text-transparent">0%</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {isLive && (
                    <LiveTrackerWidget
                        tracker={liveRace?.tracker}
                        sessionKey={sessionKey}
                        selectedDriver={driverNumber}
                    />
                )}
                
                {currentDriverInfo && (
                    <div className="bg-gray-900 p-5 rounded-xl border border-gray-800 shadow-lg">
                        <TyreHistoryWidget driver={currentDriverInfo} />
                        <PitHistoryWidget driver={currentDriverInfo} />
                    </div>
                )}

                <div className="bg-gray-900 p-5 rounded-xl border border-gray-800 relative" onMouseLeave={snapToPlayhead}>
                    <h2 className="text-sm text-gray-400 uppercase tracking-wider mb-4 flex justify-between">
                        <span>Timeline: Speed & Engine RPM</span>
                        {isLiveTracking && <span className="text-green-500 animate-pulse font-bold tracking-widest">● LIVE SYNC</span>}
                    </h2>
                    <div ref={chartRef1} className="w-full min-h-[300px]"></div>
                    
                    <div className="text-center text-xs font-mono text-gray-400 mt-2">
                        Timeline Pos: <span ref={lapXRef1} className="text-white font-bold">{legendValues.lapX}</span> &nbsp;&nbsp;&nbsp;&nbsp;
                        <span className="text-[#00ff00]">■</span> Speed: <span ref={speedRef} className="text-white font-bold">{legendValues.speed}</span> &nbsp;&nbsp;&nbsp;&nbsp;
                        <span className="text-[#ff00ff]">■</span> RPM: <span ref={rpmRef} className="text-white font-bold">{legendValues.rpm}</span>
                    </div>
                </div>
                
                <div className="bg-gray-900 p-5 rounded-xl border border-gray-800" onMouseLeave={snapToPlayhead}>
                    <h2 className="text-sm text-gray-400 uppercase tracking-wider mb-4">Timeline: Driver Inputs & Gear</h2>
                    <div ref={chartRef2} className="w-full min-h-[250px]"></div>
                    
                    <div className="text-center text-xs font-mono text-gray-400 mt-2">
                        Timeline Pos: <span ref={lapXRef2} className="text-white font-bold">{legendValues.lapX}</span> &nbsp;&nbsp;&nbsp;&nbsp;
                        <span className="text-[#00aaff]">■</span> Throttle: <span ref={throttleRef} className="text-white font-bold">{legendValues.throttle}</span> &nbsp;&nbsp;&nbsp;&nbsp;
                        <span className="text-[#ff3333]">■</span> Brake: <span ref={brakeRef} className="text-white font-bold">{legendValues.brake}</span> &nbsp;&nbsp;&nbsp;&nbsp;
                        <span className="text-[#ffaa00]">■</span> Gear: <span ref={gearRef} className="text-white font-bold">{legendValues.gear}</span>
                    </div>
                </div>

                <div className="bg-gray-900 p-5 rounded-xl border border-gray-800 flex flex-col gap-6">
                    {hasEnoughDataToScroll ? (
                        <div className="flex items-center gap-4">
                            <span className="text-xs text-gray-500 uppercase font-bold w-20">Timeline</span>
                            <input 
                                type="range" min={0} max={maxAllowedScroll} step={0.01} value={currentSliderVal}
                                onChange={(e) => {
                                    const val = parseFloat(e.target.value);
                                    setManualMin(val);
                                    setIsAutoScroll(val >= maxAllowedScroll - 0.1);
                                }}
                                className={`w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer ${isLiveTracking ? 'accent-green-500' : 'accent-blue-500'}`}
                            />
                            <span className="text-xs text-gray-400 w-24 text-right font-bold">Lap {currentSliderVal.toFixed(1)}</span>
                        </div>
                    ) : (
                        <div className="text-center text-xs text-gray-500 uppercase font-bold tracking-widest py-1">
                            Collecting telemetry data (Auto-filling viewport to 3 laps...)
                        </div>
                    )}

                    {/* EXPANDED PANEL: SPLIT INTO CURRENT LAP INFO (LEFT) & LAP HISTORY TABLE (RIGHT) */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 border-t border-gray-800 pt-4 mt-2 items-stretch h-[550px]">
                        
                        {/* LEFT COLUMN: ALL DRIVERS POSITION CHART */}
                        <div className="lg:col-span-5 flex flex-col justify-between bg-gray-800/20 p-4 rounded-lg border border-gray-800 h-full min-h-0">
                            <AllDriversPaceChart 
                                activeResults={activeResults} 
                                currentDriverNumber={driverNumber} 
                                maxRaceLap={isLive ? (liveRace?.maxRaceLap || activeData.laps?.length || 1) : (raceDetails?.maxRaceLap || activeData.laps?.length || 1)} 
                            />
                        </div>

                        {/* RIGHT COLUMN: LAP HISTORY TABLE */}
                        <div className="lg:col-span-7 bg-gray-800/20 p-4 rounded-lg border border-gray-800 flex flex-col h-full min-h-0">
                            <div className="flex justify-between items-center mb-3">
                                <span className="text-sm font-bold text-gray-300 uppercase tracking-wider">Lap History & Sectors</span>
                                <span className="text-xs text-gray-500 font-mono">Total Laps: {activeData.laps?.length || 0}</span>
                            </div>

                            <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2 custom-scrollbar min-h-0">
                                {activeData.laps && activeData.laps.length > 0 ? (
                                    [...activeData.laps].reverse().map((lap: any) => {
                                        const lapDuration = lap.lap_duration;
                                        const bestDuration = bestLapObj?.lap_duration;
                                        const delta = (lapDuration && bestDuration) ? lapDuration - bestDuration : null;
                                        const deletedLap = deletedLapByNumber.get(Number(lap.lap_number));
                                        const stint = activeData.stints?.find((s: any) => s.lap_start <= lap.lap_number && (s.lap_end >= lap.lap_number || s.lap_end === 0));
                                        const tyreCompound = stint?.compound || 'UNKNOWN';

                                        return (
                                            <div 
                                                key={lap.lap_number} 
                                                onClick={() => {
                                                    setManualMin(lap.lap_number - 1);
                                                    setIsAutoScroll(false);
                                                }}
                                                className={`flex items-center justify-between p-2.5 rounded-md border text-xs font-mono cursor-pointer transition ${
                                                    activeLapNumber === lap.lap_number 
                                                        ? 'bg-blue-600/20 border-blue-500 text-white' 
                                                        : 'bg-gray-900/50 border-gray-800 text-gray-400 hover:border-gray-700 hover:text-gray-200'
                                                }`}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <span className="font-bold w-12 text-gray-300">L{lap.lap_number}</span>
                                                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getTyreColor(tyreCompound) }} title={tyreCompound}></div>
                                                    <span className={`font-bold ${
                                                        deletedLap
                                                            ? 'text-red-300'
                                                            : isSessionBestLap(lapDuration)
                                                                ? 'text-purple-400'
                                                                : (delta === 0 ? 'text-green-400' : 'text-white')
                                                    }`}>
                                                        {formatLapTime(lapDuration)}
                                                    </span>
                                                    {!deletedLap && (
                                                        <span className={`text-[10px] ${delta === 0 ? 'text-purple-400 font-bold' : 'text-gray-300'}`}>
                                                            {delta === 0 ? 'PB' : (delta !== null ? `+${delta.toFixed(3)}s` : '')}
                                                        </span>
                                                    )}
                                                    {deletedLap && (
                                                        <span
                                                            className="text-[9px] px-1.5 py-0.5 rounded border border-red-500/40 bg-red-500/10 text-red-300 font-black uppercase tracking-wider whitespace-nowrap"
                                                            title={deletedLap.deleted_message || deletedLap.deleted_reason || 'Lap deleted by race control'}
                                                        >
                                                            Lap Deleted
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="flex items-center gap-3">
                                                    <div className="flex flex-col gap-1 w-32">
                                                        <div className="flex justify-between text-[10px] text-gray-500">
                                                            {(['s1', 's2', 's3'] as const).map((key, idx) => {
                                                                const value = lap[`duration_sector_${idx + 1}`];
                                                                const cls = isSessionBestSector(value, key) ? 'text-purple-400 font-bold'
                                                                    : isPersonalBestSector(value, key) ? 'text-green-400 font-bold'
                                                                    : 'text-gray-200';
                                                                return <span key={key} className={cls}>{key.toUpperCase()}: {value ? Number(value).toFixed(2) : '-'}</span>;
                                                            })}
                                                        </div>
                                                        {renderMinisectors(lap.segments_sector_1 || lap.seg1)}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <span className="text-xs text-gray-600 italic text-center py-6">No lap history recorded yet</span>
                                )}
                            </div>
                        </div>

                    </div>

                    <AllDriversLapTimesChart
                        activeResults={activeResults}
                        currentDriverNumber={driverNumber}
                        maxRaceLap={isLive ? (liveRace?.maxRaceLap || activeData.laps?.length || 1) : (raceDetails?.maxRaceLap || activeData.laps?.length || 1)}
                    />
                </div>
            </div>
        </div>
    );
};