import { create } from 'zustand';

type LiveRaceData = {
    results: any[];
    weather: any;
    sessionBests: any;
    isRace: boolean;
    maxRaceLap: number;
    scheduledTotalLaps?: number | null;
    raceControl: any[];
    availableSessions: any[];
    sessionName?: string;
    sessionInfo?: any;
    tracker?: {
        trace: any[];
        cars: any[];
        referenceDriver?: number | null;
        circuit?: {
            name?: string | null;
            image?: string | null;
            rotation?: number;
            corners?: any[];
        };
    };
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

    // Historical data is immutable once a session has finished, so keep it in
    // memory for the lifetime of the SPA. Route changes should not force the
    // browser to download and recalculate the same session again.
    historicalRaces: Record<string, any>;
    historicalDrivers: Record<string, DriverLiveData>;

    // Preserve the home/season view as well so the app can return from a race
    // without flashing through a full reload. Home data may still be refreshed
    // in the background after its short TTL.
    homeData: any | null;
    homeDataUpdatedAt: number;
    selectedSeason: number | null;
    seasonRaces: Record<number, any[]>;

    connect: () => void;
    subscribeToDriver: (driverNumber: number) => void;
    unsubscribeFromDriver: (driverNumber: number) => void;

    cacheHistoricalRace: (sessionKey: string, data: any) => void;
    cacheHistoricalDriver: (sessionKey: string, driverNumber: number, data: DriverLiveData) => void;
    cacheHomeData: (data: any) => void;
    setSelectedSeason: (year: number) => void;
    cacheSeasonRaces: (year: number, races: any[]) => void;
}

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const driverSubscriptions = new Set<number>();
const wsUrl = import.meta.env.PROD ? `wss://${window.location.host}` : 'ws://localhost:8080';

export const useRaceStore = create<RaceState>((set) => ({
    connected: false,
    liveRace: null,
    driverLive: {},
    historicalRaces: {},
    historicalDrivers: {},
    homeData: null,
    homeDataUpdatedAt: 0,
    selectedSeason: null,
    seasonRaces: {},

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
                            scheduledTotalLaps: Number(msg.data.scheduledTotalLaps || 0) || null,
                            raceControl: msg.data.raceControl || [],
                            availableSessions: msg.data.availableSessions || [],
                            sessionName: msg.data.sessionName,
                            sessionInfo: msg.data.sessionInfo,
                            tracker: (() => {
                                const incoming = msg.data.tracker;
                                const previous = useRaceStore.getState().liveRace?.tracker;
                                if (!incoming) return previous || { trace: [], cars: [] };

                                const incomingCars = incoming.cars || [];
                                const incomingTrace = incoming.trace || [];

                                return {
                                    ...incoming,
                                    // Never throw away the most recent known driver coordinates
                                    // just because a later snapshot has no fresh location rows.
                                    cars: incomingCars.length > 0 ? incomingCars : (previous?.cars || []),
                                    trace: incomingTrace.length > 0 ? incomingTrace : (previous?.trace || []),
                                    circuit: incoming.circuit || previous?.circuit
                                };
                            })()
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
    },

    cacheHistoricalRace: (sessionKey: string, data: any) => {
        set(state => ({
            historicalRaces: {
                ...state.historicalRaces,
                [String(sessionKey)]: data
            }
        }));
    },

    cacheHistoricalDriver: (sessionKey: string, driverNumber: number, data: DriverLiveData) => {
        const key = `${sessionKey}:${driverNumber}`;
        set(state => ({
            historicalDrivers: {
                ...state.historicalDrivers,
                [key]: data
            }
        }));
    },

    cacheHomeData: (data: any) => {
        set({
            homeData: data,
            homeDataUpdatedAt: Date.now()
        });
    },

    setSelectedSeason: (year: number) => set({ selectedSeason: year }),

    cacheSeasonRaces: (year: number, races: any[]) => {
        set(state => ({
            seasonRaces: {
                ...state.seasonRaces,
                [year]: races
            }
        }));
    }
}));
