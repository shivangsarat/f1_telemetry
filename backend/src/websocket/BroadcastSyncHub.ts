import { WebSocket } from 'ws';

type BufferedEvent = {
    at: number;
    sessionKey: string | null;
    message: any;
    payload: string;
};

type ClientState = {
    delayMs: number;
    raceCursor: number;
    driverStateCursor: Map<number, number>;
    telemetryCursor: Map<number, number>;
    subscribedDrivers: Set<number>;
};

const eventTime = (message: any) => {
    const dataDate = message?.data?.date ? new Date(message.data.date).getTime() : NaN;
    if (Number.isFinite(dataDate)) return dataDate;

    const timestamp = Number(message?.timestamp);
    return Number.isFinite(timestamp) ? timestamp : Date.now();
};

const appendSorted = (items: BufferedEvent[], entry: BufferedEvent) => {
    const last = items[items.length - 1];
    if (!last || last.at <= entry.at) {
        items.push(entry);
        return;
    }

    items.push(entry);
    items.sort((a, b) => a.at - b.at);
};

export class BroadcastSyncHub {
    private readonly historyMs: number;
    private readonly raceSampleMs: number;
    private readonly clients = new Map<WebSocket, ClientState>();
    private readonly raceHistory: BufferedEvent[] = [];
    private readonly telemetryHistory = new Map<number, BufferedEvent[]>();
    private readonly driverStateHistory = new Map<number, BufferedEvent[]>();
    private sessionKey: string | null = null;
    private lastRaceStoredAt = 0;

    constructor(historyMs = 130_000, raceSampleMs = 250) {
        this.historyMs = historyMs;
        this.raceSampleMs = raceSampleMs;
    }

    registerClient(client: WebSocket) {
        this.clients.set(client, {
            delayMs: 0,
            raceCursor: 0,
            driverStateCursor: new Map(),
            telemetryCursor: new Map(),
            subscribedDrivers: new Set()
        });
    }

    unregisterClient(client: WebSocket) {
        this.clients.delete(client);
    }

    configureDelay(client: WebSocket, seconds: number) {
        const state = this.clients.get(client);
        if (!state) return Date.now();

        const delayMs = Math.max(0, Math.min(120, Number(seconds) || 0)) * 1000;
        const target = Date.now() - delayMs;

        state.delayMs = delayMs;
        state.raceCursor = target;
        for (const driver of state.subscribedDrivers) {
            state.driverStateCursor.set(driver, target);
            state.telemetryCursor.set(driver, target);
        }

        return target;
    }

    getDelaySeconds(client: WebSocket) {
        return Math.max(0, (this.clients.get(client)?.delayMs || 0) / 1000);
    }

    getPresentationTime(client: WebSocket) {
        return Date.now() - Math.max(0, this.clients.get(client)?.delayMs || 0);
    }

    subscribeDriver(client: WebSocket, driver: number) {
        const state = this.clients.get(client);
        if (!state) return;
        const target = this.getPresentationTime(client);
        state.subscribedDrivers.add(driver);
        state.driverStateCursor.set(driver, target);
        state.telemetryCursor.set(driver, target);
    }

    unsubscribeDriver(client: WebSocket, driver: number) {
        const state = this.clients.get(client);
        if (!state) return;
        state.subscribedDrivers.delete(driver);
        state.driverStateCursor.delete(driver);
        state.telemetryCursor.delete(driver);
    }

    getSubscribedDrivers(client: WebSocket) {
        return this.clients.get(client)?.subscribedDrivers || new Set<number>();
    }

    private resetForSession(sessionKey: string | null) {
        if (!sessionKey || sessionKey === this.sessionKey) return;

        // Do not clear the rolling buffer at a source-session boundary. Delayed
        // clients may still be presenting the final seconds of the previous
        // session and must be allowed to cross the boundary naturally at T-delay.
        // Old entries age out through the normal history window.
        this.sessionKey = sessionKey;
        this.lastRaceStoredAt = 0;
    }

    recordRace(message: any) {
        const sessionKey = message?.sessionKey != null ? String(message.sessionKey) : null;
        this.resetForSession(sessionKey);

        const at = eventTime(message);
        if (at - this.lastRaceStoredAt < this.raceSampleMs) return;
        this.lastRaceStoredAt = at;

        const tracker = message?.data?.tracker;
        const compactMessage = tracker
            ? {
                ...message,
                data: {
                    ...message.data,
                    tracker: {
                        ...tracker,
                        // The static track trace is sent during bootstrap. Keeping it
                        // in every buffered frame wastes memory and bandwidth.
                        trace: []
                    }
                }
            }
            : message;

        appendSorted(this.raceHistory, {
            at,
            sessionKey,
            message: compactMessage,
            payload: JSON.stringify(compactMessage)
        });
        this.prune(at);
    }

    recordTelemetry(message: any) {
        const driver = Number(message?.driver);
        if (!Number.isFinite(driver)) return;

        const sessionKey = message?.sessionKey != null ? String(message.sessionKey) : this.sessionKey;
        if (this.sessionKey && sessionKey && sessionKey !== this.sessionKey) return;

        const at = eventTime(message);
        const history = this.telemetryHistory.get(driver) || [];
        appendSorted(history, {
            at,
            sessionKey,
            message,
            payload: JSON.stringify(message)
        });
        this.telemetryHistory.set(driver, history);
        this.prune(at);
    }

    recordDriverState(message: any) {
        const driver = Number(message?.driver);
        if (!Number.isFinite(driver)) return;

        const sessionKey = message?.sessionKey != null ? String(message.sessionKey) : this.sessionKey;
        if (this.sessionKey && sessionKey && sessionKey !== this.sessionKey) return;

        const at = eventTime(message);
        const history = this.driverStateHistory.get(driver) || [];
        const last = history[history.length - 1];
        if (last && at - last.at < 250) return;

        appendSorted(history, {
            at,
            sessionKey,
            message,
            payload: JSON.stringify(message)
        });
        this.driverStateHistory.set(driver, history);
        this.prune(at);
    }

    getRaceAtOrBefore(cutoff: number) {
        let selected: BufferedEvent | null = null;
        for (const entry of this.raceHistory) {
            if (entry.at > cutoff) break;
            selected = entry;
        }
        return selected;
    }

    private latestDue(history: BufferedEvent[], after: number, cutoff: number) {
        let selected: BufferedEvent | null = null;
        for (const entry of history) {
            if (entry.at <= after) continue;
            if (entry.at > cutoff) break;
            selected = entry;
        }
        return selected;
    }

    private telemetryDue(history: BufferedEvent[], after: number, cutoff: number) {
        const due: BufferedEvent[] = [];
        for (const entry of history) {
            if (entry.at <= after) continue;
            if (entry.at > cutoff) break;
            due.push(entry);
        }
        return due.length > 12 ? due.slice(-12) : due;
    }

    flush(now = Date.now()) {
        for (const [client, state] of this.clients) {
            if (client.readyState !== WebSocket.OPEN) continue;

            const cutoff = now - state.delayMs;

            const race = this.latestDue(this.raceHistory, state.raceCursor, cutoff);
            if (race) {
                client.send(race.payload);
                state.raceCursor = race.at;
            }

            for (const driver of state.subscribedDrivers) {
                const driverStateHistory = this.driverStateHistory.get(driver) || [];
                const driverState = this.latestDue(
                    driverStateHistory,
                    state.driverStateCursor.get(driver) || 0,
                    cutoff
                );
                if (driverState) {
                    client.send(driverState.payload);
                    state.driverStateCursor.set(driver, driverState.at);
                }

                const telemetryHistory = this.telemetryHistory.get(driver) || [];
                const telemetry = this.telemetryDue(
                    telemetryHistory,
                    state.telemetryCursor.get(driver) || 0,
                    cutoff
                );

                for (const entry of telemetry) client.send(entry.payload);
                if (telemetry.length > 0) {
                    state.telemetryCursor.set(driver, telemetry[telemetry.length - 1].at);
                }
            }
        }
    }

    private prune(referenceTime = Date.now()) {
        const cutoff = referenceTime - this.historyMs;

        while (this.raceHistory.length > 1 && this.raceHistory[0].at < cutoff) {
            this.raceHistory.shift();
        }

        for (const [driver, history] of this.telemetryHistory) {
            while (history.length > 1 && history[0].at < cutoff) history.shift();
            if (history.length === 0) this.telemetryHistory.delete(driver);
        }

        for (const [driver, history] of this.driverStateHistory) {
            while (history.length > 1 && history[0].at < cutoff) history.shift();
            if (history.length === 0) this.driverStateHistory.delete(driver);
        }
    }
}
