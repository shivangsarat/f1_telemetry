import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

type TrackerState = {
    trace?: any[];
    cars?: any[];
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

    const geometry = useMemo(() => {
        const allPoints = [
            ...trace.map((point: any) => ({ x: Number(point.x), y: Number(point.y) })),
            ...cars.map((car: any) => ({ x: Number(car.x), y: Number(car.y) }))
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

        const project = (x: number, y: number) => ({
            x: padding + (x - minX) * scale,
            y: height - padding - (y - minY) * scale
        });

        const path = trace
            .filter((point: any) => Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)))
            .map((point: any, index: number) => {
                const p = project(Number(point.x), Number(point.y));
                return `${index === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
            })
            .join(' ');

        return { width, height, project, path };
    }, [trace, cars, compact]);

    if (!geometry) {
        return (
            <div className="h-48 flex items-center justify-center text-xs text-gray-500 uppercase tracking-widest font-bold">
                Awaiting live location stream…
            </div>
        );
    }

    const sortedCars = [...cars].sort((a: any, b: any) => Number(a.position || 99) - Number(b.position || 99));

    return (
        <div className="w-full">
            <svg
                viewBox={`0 0 ${geometry.width} ${geometry.height}`}
                className={`w-full ${compact ? 'max-h-[280px]' : 'max-h-[650px]'}`}
                role="img"
                aria-label="Live driver positions around the circuit"
            >
                <rect x="0" y="0" width={geometry.width} height={geometry.height} rx="22" fill="#0b1220" />
                {geometry.path && (
                    <>
                        <path d={geometry.path} fill="none" stroke="#1f2937" strokeWidth={compact ? 16 : 22} strokeLinecap="round" strokeLinejoin="round" />
                        <path d={geometry.path} fill="none" stroke="#64748b" strokeWidth={compact ? 3 : 4} strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
                    </>
                )}

                {sortedCars.map((car: any) => {
                    const point = geometry.project(Number(car.x), Number(car.y));
                    const selected = Number(car.driver_number) === Number(selectedDriver);
                    const radius = selected ? (compact ? 11 : 14) : (compact ? 7 : 9);
                    return (
                        <g key={car.driver_number}>
                            {selected && (
                                <circle cx={point.x} cy={point.y} r={radius + 7} fill="none" stroke="#ffffff" strokeWidth="3" opacity="0.8" />
                            )}
                            <circle
                                cx={point.x}
                                cy={point.y}
                                r={radius}
                                fill={normalizeColor(car.team_color)}
                                stroke={selected ? '#ffffff' : '#111827'}
                                strokeWidth={selected ? 3 : 2}
                            />
                            <text
                                x={point.x}
                                y={point.y + 3.5}
                                textAnchor="middle"
                                fontSize={compact ? 9 : 11}
                                fontWeight="900"
                                fill="#05070b"
                            >
                                {car.driver_number}
                            </text>
                            {(!compact || selected) && (
                                <text
                                    x={point.x + radius + 6}
                                    y={point.y + 4}
                                    fontSize={selected ? 15 : 11}
                                    fontWeight={selected ? 900 : 700}
                                    fill={selected ? '#ffffff' : '#cbd5e1'}
                                >
                                    {car.acronym || car.name}
                                </text>
                            )}
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
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: normalizeColor(car.team_color) }} />
                                <span className={`font-mono text-xs truncate ${selected ? 'font-black text-white' : 'font-bold text-gray-300'}`}>
                                    P{car.position ?? '-'} · {car.name} #{car.driver_number}
                                </span>
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
    selectedDriver
}: {
    tracker?: TrackerState | null;
    sessionKey?: string;
    selectedDriver?: number;
}) => {
    const [minimized, setMinimized] = useState(false);

    return (
        <div className="bg-gray-900 border border-gray-800 rounded-xl shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-xs font-black uppercase tracking-widest text-gray-200">Live Driver Tracker</span>
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
                <div className="p-3">
                    <LiveTrackMap tracker={tracker} selectedDriver={selectedDriver} compact />
                </div>
            )}
        </div>
    );
};
