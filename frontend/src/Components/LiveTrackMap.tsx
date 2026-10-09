import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useRaceStore } from '../store/useRaceStore';

type TrackerState = {
    trace?: any[];
    cars?: any[];
    circuit?: {
        name?: string | null;
        image?: string | null;
        rotation?: number;
        corners?: any[];
    };
};

const getTrackerTeamVariant = (car: any, cars: any[]) => {
    const teamKey = String(car?.team_name || car?.team || car?.team_color || '').toLowerCase();
    const teammates = cars
        .filter(item => String(item?.team_name || item?.team || item?.team_color || '').toLowerCase() === teamKey)
        .sort((a, b) => Number(a.driver_number) - Number(b.driver_number));
    return Math.max(0, teammates.findIndex(item => Number(item.driver_number) === Number(car.driver_number)));
};

const normalizeColor = (value: any) => {
    const raw = String(value || 'ffffff').replace('#', '');
    return /^([0-9a-fA-F]{6})$/.test(raw) ? `#${raw}` : '#ffffff';
};

export const LiveTrackMap = ({
    tracker,
    selectedDriver,
    compact = false
}: {
    tracker?: TrackerState | null;
    selectedDriver?: number;
    compact?: boolean;
}) => {
    const trace = tracker?.trace || [];
    const cars = tracker?.cars || [];
    const broadcastDelaySeconds = useRaceStore(state => state.broadcastDelaySeconds);
    const circuitCorners = tracker?.circuit?.corners || [];
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);

    const lastLocationTime = cars.reduce((latest: number, car: any) => {
        const time = car?.date ? new Date(car.date).getTime() : NaN;
        return Number.isFinite(time) ? Math.max(latest, time) : latest;
    }, 0);
    const hasRecordedPositions = cars.length > 0;
    const presentationNow = now - (broadcastDelaySeconds * 1000);
    const isStreaming = hasRecordedPositions && lastLocationTime > 0 && (presentationNow - lastLocationTime) <= 5000;
    const trackerMode = isStreaming ? 'LIVE' : hasRecordedPositions ? 'LAST RECORDED' : 'MAP ONLY';

    const geometry = useMemo(() => {
        const rotationRadians = (Number(tracker?.circuit?.rotation || 0) * Math.PI) / 180;
        const rotate = (x: number, y: number) => ({
            x: (x * Math.cos(rotationRadians)) - (y * Math.sin(rotationRadians)),
            y: (x * Math.sin(rotationRadians)) + (y * Math.cos(rotationRadians))
        });

        const allPoints = [
            ...circuitCorners.map((point: any) => rotate(Number(point.x), Number(point.y))),
            ...trace.map((point: any) => rotate(Number(point.x), Number(point.y))),
            ...cars.map((car: any) => rotate(Number(car.x), Number(car.y)))
        ].filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));

        if (!allPoints.length) return null;

        let minX = Math.min(...allPoints.map(point => point.x));
        let maxX = Math.max(...allPoints.map(point => point.x));
        let minY = Math.min(...allPoints.map(point => point.y));
        let maxY = Math.max(...allPoints.map(point => point.y));

        if (minX === maxX) { minX -= 1; maxX += 1; }
        if (minY === maxY) { minY -= 1; maxY += 1; }

        const width = 1000;
        const height = compact ? 380 : 620;
        const padding = compact ? 42 : 58;
        const scaleX = (width - padding * 2) / (maxX - minX);
        const scaleY = (height - padding * 2) / (maxY - minY);
        const scale = Math.min(scaleX, scaleY);

        const project = (x: number, y: number) => {
            const rotated = rotate(x, y);
            return {
                x: padding + (rotated.x - minX) * scale,
                y: height - padding - (rotated.y - minY) * scale
            };
        };

        const officialPathSource = circuitCorners
            .filter((point: any) => Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)));
        const livePathSource = trace
            .filter((point: any) => Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)));

        const makePath = (points: any[]) => points
            .map((point: any, index: number) => {
                const p = project(Number(point.x), Number(point.y));
                return `${index === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
            })
            .join(' ');

        return {
            width,
            height,
            project,
            officialPath: makePath(officialPathSource),
            livePath: makePath(livePathSource)
        };
    }, [trace, cars, circuitCorners, compact, tracker?.circuit?.rotation]);

    if (!geometry) {
        return (
            <div className="w-full">
                <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-[10px] uppercase tracking-widest font-bold text-gray-400">
                        {tracker?.circuit?.name || 'Circuit map'}
                    </span>
                    <span className={`text-[9px] uppercase tracking-wider font-black ${isStreaming ? 'text-green-400' : hasRecordedPositions ? 'text-amber-400' : 'text-gray-500'}`}>
                        {trackerMode}
                    </span>
                </div>

                {tracker?.circuit?.image ? (
                    <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-4">
                        <img
                            src={tracker.circuit.image}
                            alt={`${tracker?.circuit?.name || 'Circuit'} map`}
                            className={`w-full object-contain ${compact ? 'max-h-[250px]' : 'max-h-[580px]'} opacity-90`}
                        />
                    </div>
                ) : (
                    <div className="h-48 rounded-xl border border-gray-800 bg-gray-950/40 flex items-center justify-center text-xs text-gray-500 uppercase tracking-widest font-bold">
                        Circuit geometry unavailable
                    </div>
                )}

                {hasRecordedPositions && (
                    <div className="mt-3 flex flex-wrap gap-2">
                        {[...cars]
                            .sort((a: any, b: any) => Number(a.position || 99) - Number(b.position || 99))
                            .map((car: any) => (
                                <div key={car.driver_number} className="px-2.5 py-1.5 rounded border border-gray-800 bg-gray-950/60 flex items-center gap-2">
                                    <span
                                        className={`w-2.5 h-2.5 ${getTrackerTeamVariant(car, cars) % 2 === 1 ? 'rotate-45 rounded-[1px]' : 'rounded-full'}`}
                                        style={{ backgroundColor: normalizeColor(car.team_color) }}
                                    />
                                    <span className="font-mono text-[10px] font-bold text-gray-300">
                                        P{car.position ?? '-'} · {car.acronym || car.name} #{car.driver_number}
                                    </span>
                                </div>
                            ))}
                    </div>
                )}
            </div>
        );
    }

    const sortedCars = [...cars].sort((a: any, b: any) => Number(a.position || 99) - Number(b.position || 99));

    return (
        <div className="w-full">
            {tracker?.circuit?.name && (
                <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-[10px] uppercase tracking-widest font-bold text-gray-400">
                        {tracker.circuit.name}
                    </span>
                    <span className={`text-[9px] uppercase tracking-wider font-black ${isStreaming ? 'text-green-400' : hasRecordedPositions ? 'text-amber-400' : 'text-gray-500'}`}>
                        {isStreaming ? 'Live positions' : hasRecordedPositions ? 'Last recorded positions' : 'Circuit map'}
                    </span>
                </div>
            )}
            <svg
                viewBox={`0 0 ${geometry.width} ${geometry.height}`}
                className={`w-full ${compact ? 'max-h-[280px]' : 'max-h-[650px]'}`}
                role="img"
                aria-label="Live driver positions around the circuit"
            >
                <rect x="0" y="0" width={geometry.width} height={geometry.height} rx="22" fill="#0b1220" />
                {geometry.officialPath && (
                    <>
                        <path d={geometry.officialPath} fill="none" stroke="#111827" strokeWidth={compact ? 18 : 24} strokeLinecap="round" strokeLinejoin="round" />
                        <path d={geometry.officialPath} fill="none" stroke="#475569" strokeWidth={compact ? 4 : 5} strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
                    </>
                )}
                {geometry.livePath && (
                    <path
                        d={geometry.livePath}
                        fill="none"
                        stroke="#94a3b8"
                        strokeWidth={compact ? 2 : 3}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={geometry.officialPath ? 0.45 : 0.9}
                    />
                )}

                {!compact && circuitCorners.map((corner: any, index: number) => {
                    const point = geometry.project(Number(corner.x), Number(corner.y));
                    return (
                        <g key={`corner-${corner.number ?? index}-${corner.letter || ''}`}>
                            <circle cx={point.x} cy={point.y} r="3" fill="#64748b" />
                            <text x={point.x + 6} y={point.y - 5} fontSize="10" fill="#64748b" fontWeight="700">
                                T{corner.number ?? index + 1}{corner.letter || ''}
                            </text>
                        </g>
                    );
                })}

                {sortedCars.map((car: any) => {
                    const point = geometry.project(Number(car.x), Number(car.y));
                    const selected = Number(car.driver_number) === Number(selectedDriver);
                    const radius = selected ? (compact ? 11 : 14) : (compact ? 7 : 9);
                    const teamVariant = getTrackerTeamVariant(car, sortedCars);
                    const useDiamond = teamVariant % 2 === 1;
                    const diamondSize = radius * 1.45;
                    return (
                        <g key={car.driver_number}>
                            {selected && (
                                <circle cx={point.x} cy={point.y} r={radius + 7} fill="none" stroke="#ffffff" strokeWidth="3" opacity="0.8" />
                            )}
                            {useDiamond ? (
                                <rect
                                    x={point.x - diamondSize / 2}
                                    y={point.y - diamondSize / 2}
                                    width={diamondSize}
                                    height={diamondSize}
                                    rx="1.5"
                                    transform={`rotate(45 ${point.x} ${point.y})`}
                                    fill={normalizeColor(car.team_color)}
                                    fillOpacity={isStreaming ? 1 : 0.6}
                                    stroke={selected ? '#ffffff' : '#111827'}
                                    strokeWidth={selected ? 3 : 2}
                                />
                            ) : (
                                <circle
                                    cx={point.x}
                                    cy={point.y}
                                    r={radius}
                                    fill={normalizeColor(car.team_color)}
                                    fillOpacity={isStreaming ? 1 : 0.6}
                                    stroke={selected ? '#ffffff' : '#111827'}
                                    strokeWidth={selected ? 3 : 2}
                                />
                            )}
                            <text
                                x={point.x}
                                y={point.y + 3.5}
                                textAnchor="middle"
                                fontSize={compact ? 9 : 11}
                                fontWeight="900"
                                fill="#ffffff"
                                stroke="#0b1220"
                                strokeWidth="2.5"
                                paintOrder="stroke"
                            >
                                {car.driver_number}
                            </text>
                            {(!compact || selected) && (() => {
                                const candidate = String(car.acronym || car.name || '').trim();
                                const outsideLabel = candidate === String(car.driver_number) ? '' : candidate;
                                if (!outsideLabel) return null;

                                return (
                                    <text
                                        x={point.x + radius + 6}
                                        y={point.y + 4}
                                        fontSize={selected ? 15 : 11}
                                        fontWeight={selected ? 900 : 700}
                                        fill={normalizeColor(car.team_color)}
                                        stroke="#0b1220"
                                        strokeWidth="3"
                                        paintOrder="stroke"
                                    >
                                        {outsideLabel}
                                    </text>
                                );
                            })()}
                        </g>
                    );
                })}
            </svg>

            {!compact && (
                <div className="mt-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                    {sortedCars.map((car: any) => {
                        const selected = Number(car.driver_number) === Number(selectedDriver);
                        return (
                            <div
                                key={car.driver_number}
                                className={`px-2.5 py-2 rounded border flex items-center gap-2 min-w-0 ${selected ? 'border-white bg-white/10' : 'border-gray-800 bg-gray-900/70'}`}
                            >
                                <span
                                    className={`w-2.5 h-2.5 shrink-0 ${getTrackerTeamVariant(car, sortedCars) % 2 === 1 ? 'rotate-45 rounded-[1px]' : 'rounded-full'}`}
                                    style={{ backgroundColor: normalizeColor(car.team_color) }}
                                />
                                <div className="min-w-0 flex-1">
                                    <div className={`text-xs truncate ${selected ? 'font-black text-white' : 'font-bold text-gray-200'}`}>
                                        {car.name} <span className="font-mono text-gray-500">#{car.driver_number}</span>
                                    </div>
                                    <div className="mt-0.5 flex items-center gap-2 text-[9px] font-bold uppercase tracking-wider">
                                        <span className={selected ? 'text-white' : 'text-blue-400'}>
                                            P{car.position ?? '-'}
                                        </span>
                                        {car.team_name && (
                                            <span className="truncate" style={{ color: normalizeColor(car.team_color) }}>
                                                {car.team_name}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export const LiveTrackerWidget = ({
    tracker,
    sessionKey,
    selectedDriver,
    sticky = true,
    defaultMinimized = true
}: {
    tracker?: TrackerState | null;
    sessionKey?: string;
    selectedDriver?: number;
    sticky?: boolean;
    defaultMinimized?: boolean;
}) => {
    const [minimized, setMinimized] = useState(defaultMinimized);

    return (
        <div
            className={`bg-gray-900 border border-gray-800 rounded-xl shadow-xl overflow-hidden ${sticky ? 'fixed left-6 bottom-6 z-[55] w-[min(520px,calc(100vw-3rem))]' : ''}`}
        >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${tracker?.cars?.length ? 'bg-green-500' : 'bg-gray-500'}`} />
                    <span className="text-xs font-black uppercase tracking-widest text-gray-200">Driver Tracker</span>
                </div>
                <div className="flex items-center gap-2">
                    <Link
                        to={`/race/${sessionKey || 'live'}/tracker`}
                        className="text-[10px] font-bold uppercase tracking-wider text-blue-400 hover:text-blue-300"
                    >
                        Full Map
                    </Link>
                    <button
                        type="button"
                        onClick={() => setMinimized(value => !value)}
                        className="w-7 h-7 rounded border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 text-sm font-black"
                        aria-label={minimized ? 'Expand live tracker' : 'Minimize live tracker'}
                    >
                        {minimized ? '+' : '−'}
                    </button>
                </div>
            </div>
            {!minimized && (
                <div className={`p-3 ${sticky ? 'max-h-[390px] overflow-y-auto custom-scrollbar' : ''}`}>
                    <LiveTrackMap tracker={tracker} selectedDriver={selectedDriver} compact />
                </div>
            )}
        </div>
    );
};
