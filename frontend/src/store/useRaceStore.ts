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
    meetingInfo?: any;
    circuitInfo?: any;
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
    driver?: any;
    telemetry: any[];
    laps: any[];
    stints: any[];
    locations?: any[];
};

interface RaceState {
    connected: boolean;
    liveSessionKey: string | null;
    broadcastDelaySeconds: number;
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
    setBroadcastDelaySeconds: (seconds: number) => void;

    cacheHistoricalRace: (sessionKey: string, data: any) => void;
    cacheHistoricalDriver: (sessionKey: string, driverNumber: number, data: DriverLiveData) => void;
    cacheHomeData: (data: any) => void;
    setSelectedSeason: (year: number) => void;
    cacheSeasonRaces: (year: number, races: any[]) => void;
}

const mergeTelemetryHistory = (existing: any[] = [], incoming: any[] = []) => {
    if (incoming.length === 0) return existing;

    const byKey = new Map<string, any>();
    const keyForPoint = (point: any, index: number) =>
        String(point?.date || point?._key || point?._id || `${point?.lapX ?? 'x'}:${index}`);

    existing.forEach((point, index) => byKey.set(keyForPoint(point, index), point));
    incoming.forEach((point, index) => {
        const key = String(point?.date || point?._key || point?._id || `${point?.lapX ?? 'x'}:incoming:${index}`);
        byKey.set(key, point);
    });

    const merged = [...byKey.values()].sort((a, b) => {
        const aTime = a?.date ? new Date(a.date).getTime() : NaN;
        const bTime = b?.date ? new Date(b.date).getTime() : NaN;
        if (Number.isFinite(aTime) && Number.isFinite(bTime)) return aTime - bTime;
        return Number(a?.lapX || 0) - Number(b?.lapX || 0);
    });

    return merged.length > 30_000 ? merged.slice(-30_000) : merged;
};

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const driverSubscriptions = new Set<number>();
const wsUrl = import.meta.env.PROD ? `wss://${window.location.host}` : 'ws://localhost:8080';

export const useRaceStore = create<RaceState>((set) => ({
    connected: false,
    liveSessionKey: null,
    broadcastDelaySeconds: 0,
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

            const state = useRaceStore.getState();
            ws?.send(JSON.stringify({
                type: 'SET_BROADCAST_DELAY',
                seconds: state.broadcastDelaySeconds,
                sessionKey: state.liveSessionKey
            }));

            driverSubscriptions.forEach(driver => {
                ws?.send(JSON.stringify({ type: 'SUBSCRIBE_DRIVER', driver }));
            });
        };

        ws.onmessage = event => {
            try {
                const msg = JSON.parse(event.data);

                if (msg.type === 'LIVE_RACE_STATE' && msg.data) {
                    const incomingSessionKey = msg.sessionKey != null ? String(msg.sessionKey) : null;
                    const previousState = useRaceStore.getState();
                    const previousSessionKey = previousState.liveSessionKey;
                    const sessionChanged = Boolean(
                        incomingSessionKey
                        && previousSessionKey
                        && incomingSessionKey !== previousSessionKey
                    );

                    let nextBroadcastDelay = previousState.broadcastDelaySeconds;
                    if (incomingSessionKey && incomingSessionKey !== previousSessionKey) {
                        const saved = window.localStorage.getItem(`broadcast-sync:${incomingSessionKey}`);
                        nextBroadcastDelay = saved == null
                            ? 0
                            : Math.max(0, Math.min(120, Number(saved) || 0));

                        if (ws?.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({
                                type: 'SET_BROADCAST_DELAY',
                                seconds: nextBroadcastDelay,
                                sessionKey: incomingSessionKey
                            }));
                        }
                    }

                    set({
                        liveSessionKey: incomingSessionKey || previousSessionKey,
                        broadcastDelaySeconds: nextBroadcastDelay,
                        ...(sessionChanged ? { driverLive: {} } : {}),
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
                            meetingInfo: msg.data.meetingInfo,
                            circuitInfo: msg.data.circuitInfo,
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
                                telemetry: msg.data.telemetry
                                    ? mergeTelemetryHistory(
                                        state.driverLive[Number(msg.driver)]?.telemetry || [],
                                        msg.data.telemetry
                                    )
                                    : state.driverLive[Number(msg.driver)]?.telemetry || [],
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
                        const telemetry = mergeTelemetryHistory(existing.telemetry, [msg.data]);
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

    setBroadcastDelaySeconds: (seconds: number) => {
        const clamped = Math.max(0, Math.min(120, Math.round(Number(seconds) || 0)));
        const sessionKey = useRaceStore.getState().liveSessionKey;

        set({ broadcastDelaySeconds: clamped });

        if (sessionKey) {
            window.localStorage.setItem(`broadcast-sync:${sessionKey}`, String(clamped));
        }

        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'SET_BROADCAST_DELAY',
                seconds: clamped,
                sessionKey
            }));
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
