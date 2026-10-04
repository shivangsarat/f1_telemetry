import { create } from 'zustand';

export interface RaceState {
    intervals: any[];
    weather: any;
    sessionBests: any;
    isRace: boolean;
    maxRaceLap: number;
    raceControl: any[];
    driverTelemetry: Record<number, any[]>; // Stores live telemetry arrays keyed by driver number
    connect: () => void;
    subscribeToDriver: (driverNumber: number) => void;
    unsubscribeFromDriver: (driverNumber: number) => void;
}

let ws: WebSocket | null = null;
const wsUrl = import.meta.env.PROD ? `wss://${window.location.host}` : 'ws://localhost:8080';

const formatGap = (gap: any) => {
    if (gap === null || gap === undefined || gap === '') return '-';
    if (typeof gap === 'string' && gap.toUpperCase().includes('LAP')) return gap;
    const num = Number(gap);
    if (isNaN(num)) return '-';
    return `+${num.toFixed(3)}s`;
};

export const useRaceStore = create<RaceState>((set) => ({
    intervals: [],
    weather: null,
    sessionBests: null,
    isRace: true,
    maxRaceLap: 0,
    raceControl: [],
    driverTelemetry: {},

    connect: () => {
        if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;

        ws = new WebSocket(wsUrl);

        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);

            if (msg.type === 'RACE_CONTROL_UPDATE' && msg.data) {
                set((state) => {
                    const incoming = Array.isArray(msg.data) ? msg.data : [msg.data];
                    return { raceControl: [...incoming, ...state.raceControl] };
                });
            }
            if (msg.type === 'WEATHER_UPDATE' && msg.data) {
                set({ weather: msg.data });
            }
            if (msg.type === 'INTERVAL_UPDATE' && msg.data) {
                set((state) => {
                    const existing = state.intervals.find(d => String(d.driver_number) === String(msg.data.driver_number)) || { driver_number: msg.data.driver_number };
                    const updated = { 
                        ...existing, 
                        gap_to_leader: formatGap(msg.data.gap_to_leader), 
                        interval: formatGap(msg.data.interval) 
                    };
                    return {
                        intervals: [...state.intervals.filter(d => String(d.driver_number) !== String(msg.data.driver_number)), updated]
                    };
                });
            }
            if (msg.type === 'POSITION_UPDATE' && msg.data) {
                set((state) => {
                    const existing = state.intervals.find(d => String(d.driver_number) === String(msg.data.driver_number)) || { driver_number: msg.data.driver_number };
                    const updated = { ...existing, position: msg.data.position };
                    return {
                        intervals: [...state.intervals.filter(d => String(d.driver_number) !== String(msg.data.driver_number)), updated]
                    };
                });
            }

            if (msg.type === 'TELEMETRY_UPDATE' && msg.driver && msg.data?.telemetry) {
                set((state) => ({
                    driverTelemetry: {
                        ...state.driverTelemetry,
                        [msg.driver]: msg.data.telemetry
                    }
                }));
            }
        };
    },

    subscribeToDriver: (driverNumber: number) => {
        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'SUBSCRIBE_TELEMETRY', driver: driverNumber }));
        }
    },

    unsubscribeFromDriver: (driverNumber: number) => {
        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'UNSUBSCRIBE_TELEMETRY', driver: driverNumber }));
        }
    }
}));