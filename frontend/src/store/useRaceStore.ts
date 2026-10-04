import { create } from 'zustand';

// Extend your existing RaceState interface
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

            // 1. Handle Global Dashboard Tick
            if (msg.type === 'GLOBAL_TICK' && msg.data) {
                set({
                    intervals: msg.data.results || [],
                    weather: msg.data.weather || null,
                    sessionBests: msg.data.sessionBests || null,
                    isRace: msg.data.isRace ?? true,
                    maxRaceLap: msg.data.maxRaceLap || 0,
                    raceControl: msg.raceControl || []
                });
            }

            // 2. Handle Specific Driver Telemetry Stream
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