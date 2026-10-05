import { create } from 'zustand';

type LiveRaceData = {
    results: any[];
    weather: any;
    sessionBests: any;
    isRace: boolean;
    maxRaceLap: number;
    raceControl: any[];
    availableSessions: any[];
    sessionName?: string;
    sessionInfo?: any;
};

type DriverLiveData = {
    driver: any;
    telemetry: any[];
    laps: any[];
    stints: any[];
};

interface RaceState {
    connected: boolean;
    liveRace: LiveRaceData | null;
    driverLive: Record<number, DriverLiveData>;
    connect: () => void;
    subscribeToDriver: (driverNumber: number) => void;
    unsubscribeFromDriver: (driverNumber: number) => void;
}

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const driverSubscriptions = new Set<number>();
const wsUrl = import.meta.env.PROD ? `wss://${window.location.host}` : 'ws://localhost:8080';

export const useRaceStore = create<RaceState>((set) => ({
    connected: false,
    liveRace: null,
    driverLive: {},

    connect: () => {
        if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;

        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            set({ connected: true });
            driverSubscriptions.forEach(driver => {
                ws?.send(JSON.stringify({ type: 'SUBSCRIBE_DRIVER', driver }));
            });
        };

        ws.onmessage = event => {
            try {
                const msg = JSON.parse(event.data);

                if (msg.type === 'LIVE_RACE_STATE' && msg.data) {
                    set({
                        liveRace: {
                            results: msg.data.results || [],
                            weather: msg.data.weather || null,
                            sessionBests: msg.data.sessionBests || null,
                            isRace: Boolean(msg.data.isRace),
                            maxRaceLap: Number(msg.data.maxRaceLap || 0),
                            raceControl: msg.data.raceControl || [],
                            availableSessions: msg.data.availableSessions || [],
                            sessionName: msg.data.sessionName,
                            sessionInfo: msg.data.sessionInfo
                        }
                    });
                }

                if (msg.type === 'LIVE_DRIVER_STATE' && msg.driver && msg.data) {
                    set(state => ({
                        driverLive: {
                            ...state.driverLive,
                            [Number(msg.driver)]: {
                                ...(state.driverLive[Number(msg.driver)] || { telemetry: [], laps: [], stints: [] }),
                                ...msg.data,
                                telemetry: msg.data.telemetry ?? state.driverLive[Number(msg.driver)]?.telemetry ?? [],
                                laps: msg.data.laps ?? state.driverLive[Number(msg.driver)]?.laps ?? [],
                                stints: msg.data.stints ?? state.driverLive[Number(msg.driver)]?.stints ?? []
                            }
                        }
                    }));
                }

                if (msg.type === 'LIVE_TELEMETRY_POINT' && msg.driver && msg.data) {
                    const driver = Number(msg.driver);
                    set(state => {
                        const existing = state.driverLive[driver] || { driver: null, telemetry: [], laps: [], stints: [] };
                        const telemetry = [...existing.telemetry, msg.data];
                        if (telemetry.length > 30_000) telemetry.splice(0, telemetry.length - 30_000);
                        return {
                            driverLive: {
                                ...state.driverLive,
                                [driver]: { ...existing, telemetry }
                            }
                        };
                    });
                }
            } catch (error) {
                console.error('Invalid live WebSocket payload', error);
            }
        };

        ws.onerror = () => set({ connected: false });

        ws.onclose = () => {
            set({ connected: false });
            ws = null;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => {
                useRaceStore.getState().connect();
            }, 2000);
        };
    },

    subscribeToDriver: (driverNumber: number) => {
        driverSubscriptions.add(driverNumber);
        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'SUBSCRIBE_DRIVER', driver: driverNumber }));
        }
    },

    unsubscribeFromDriver: (driverNumber: number) => {
        driverSubscriptions.delete(driverNumber);
        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'UNSUBSCRIBE_DRIVER', driver: driverNumber }));
        }
    }
}));
