import { WebSocketServer, WebSocket } from 'ws';
import { CONFIG } from '../config';
import { ITelemetryProvider } from '../providers/ITelemetryProvider';
import { FreeFastF1Provider } from '../providers/FreeFastF1Provider';
import { OpenF1PaidProvider } from '../providers/OpenF1PaidProvider';
import { LiveSessionEngine } from '../services/liveSessionEngine';
import { getCleanTelemetry, getCurrentLiveSession, getRaceDetails, getScheduledTotalLaps } from '../services/dataService';

export const setupWebSocket = async (server: any) => {
    // Attach WebSocket handling immediately. Provider/bootstrap initialization may
    // take time, but browser connections and driver subscription intents should
    // never be lost while the live provider is coming online.
    const wss = new WebSocketServer({ server });
    const engine = new LiveSessionEngine();

    const clientDriverSubs = new Map<WebSocket, Set<number>>();
    const clientUnsubscribers = new Map<WebSocket, Map<number, () => void>>();
    const clientDelayMs = new Map<WebSocket, number>();
    const clientDelaySessionKey = new Map<WebSocket, string | null>();
    const clientDelayTimers = new Map<WebSocket, Set<ReturnType<typeof setTimeout>>>();
    const clientConfiguredDelay = new Set<WebSocket>();

    // Keep a small rolling presentation buffer so a client that enables
    // Broadcast Sync can immediately start at T-delay and replay forward,
    // instead of showing one delayed frame and then freezing for the full
    // configured delay while the normal delayed stream catches up.
    const raceSnapshotHistory: Array<{ timestamp: number; snapshot: any }> = [];
    const SNAPSHOT_HISTORY_MS = 130_000;
    const SNAPSHOT_SAMPLE_MS = 1000;
    let lastRecordedSnapshotAt = 0;

    const recordRaceSnapshot = (snapshot: any) => {
        const timestamp = Number(snapshot?.timestamp) || Date.now();

        // Tracker snapshots can arrive at high frequency. 250ms is enough to
        // keep motion smooth while bounding memory/timer pressure.
        if (timestamp - lastRecordedSnapshotAt < SNAPSHOT_SAMPLE_MS) return;
        lastRecordedSnapshotAt = timestamp;

        const tracker = snapshot?.data?.tracker;
        const compactSnapshot = tracker
            ? {
                ...snapshot,
                data: {
                    ...snapshot.data,
                    tracker: {
                        ...tracker,
                        trace: []
                    }
                }
            }
            : snapshot;

        raceSnapshotHistory.push({ timestamp, snapshot: compactSnapshot });
        const cutoff = timestamp - SNAPSHOT_HISTORY_MS;
        while (raceSnapshotHistory.length > 1 && raceSnapshotHistory[0].timestamp < cutoff) {
            raceSnapshotHistory.shift();
        }
    };

    const clearClientDelayTimers = (client: WebSocket) => {
        const timers = clientDelayTimers.get(client);
        if (timers) {
            for (const timer of timers) clearTimeout(timer);
            timers.clear();
        }
    };

    const scheduleClientPayload = (client: WebSocket, payload: string, delayMs: number) => {
        if (delayMs <= 0) {
            if (client.readyState === WebSocket.OPEN) client.send(payload);
            return;
        }

        const timers = clientDelayTimers.get(client) || new Set<ReturnType<typeof setTimeout>>();
        clientDelayTimers.set(client, timers);

        const timer = setTimeout(() => {
            timers.delete(timer);
            if (client.readyState === WebSocket.OPEN) client.send(payload);
        }, delayMs);
        timers.add(timer);
    };

    const replayBufferedRaceState = (client: WebSocket, delayMs: number) => {
        const now = Date.now();
        const target = now - Math.max(0, delayMs);
        const current = engine.getSnapshot();

        if (delayMs <= 0) {
            sendClient(client, current, true);
            return;
        }

        const sameSessionHistory = raceSnapshotHistory.filter(entry =>
            !current?.sessionKey
            || !entry.snapshot?.sessionKey
            || String(entry.snapshot.sessionKey) === String(current.sessionKey)
        );

        let bootstrapEntry: { timestamp: number; snapshot: any } | undefined;
        for (const entry of sameSessionHistory) {
            if (entry.timestamp <= target) bootstrapEntry = entry;
            else break;
        }

        // If the backend has not itself been alive for the whole configured
        // delay, use the oldest available race snapshot for metadata/state and
        // reconstruct the tracker specifically at T-delay from retained location
        // history. This still avoids an empty/frozen full-map page.
        const baseSnapshot = bootstrapEntry?.snapshot
            || sameSessionHistory[0]?.snapshot
            || current;

        const bootstrap = {
            ...baseSnapshot,
            timestamp: target,
            data: {
                ...(baseSnapshot?.data || current?.data || {}),
                tracker: engine.getTrackerSnapshotAt(target)
            }
        };

        sendClient(client, bootstrap, true);

        // Replay already-buffered snapshots in wall-clock order. Example:
        // with a 42s delay, T-42 is sent immediately, T-41 one second later,
        // ... and the normal live message received at T is already scheduled by
        // sendClient for T+42. There is therefore no 42-second dead period.
        const replayFrom = bootstrapEntry?.timestamp ?? target;
        for (const entry of sameSessionHistory) {
            if (entry.timestamp <= replayFrom || entry.timestamp > now) continue;
            const offset = Math.max(0, entry.timestamp - target);
            if (offset > delayMs) continue;
            scheduleClientPayload(client, JSON.stringify(entry.snapshot), offset);
        }
    };

    const sendClient = (client: WebSocket, message: any, forceImmediate = false) => {
        if (client.readyState !== WebSocket.OPEN) return;

        const messageSessionKey = message?.sessionKey != null ? String(message.sessionKey) : null;
        const configuredSessionKey = clientDelaySessionKey.get(client) ?? null;

        // Broadcast delay is session-scoped. When a new live session arrives,
        // immediately fall back to realtime until the browser supplies that
        // session's saved preference (if any).
        if (messageSessionKey && configuredSessionKey && messageSessionKey !== configuredSessionKey) {
            clearClientDelayTimers(client);
            clientDelayMs.set(client, 0);
            clientDelaySessionKey.set(client, messageSessionKey);
        } else if (messageSessionKey && !configuredSessionKey) {
            clientDelaySessionKey.set(client, messageSessionKey);
        }

        const payload = JSON.stringify(message);
        const delay = forceImmediate ? 0 : Math.max(0, clientDelayMs.get(client) || 0);

        if (delay <= 0) {
            client.send(payload);
            return;
        }

        scheduleClientPayload(client, payload, delay);
    };

    const sendCurrentClientState = (client: WebSocket) => {
        sendClient(client, engine.getSnapshot());
        for (const driver of clientDriverSubs.get(client) || []) {
            sendClient(client, engine.getDriverSnapshot(driver, false));
        }
    };

    let provider: ITelemetryProvider | null = null;
    let providerReady = false;
    let engineBroadcastBound = false;
    let lapCountSessionKey: string | null = null;

    const broadcastSnapshot = () => {
        const snapshot = engine.getSnapshot();
        recordRaceSnapshot(snapshot);
        wss.clients.forEach(client => sendClient(client, snapshot));
    };

    const attachEngineBroadcast = () => {
        if (engineBroadcastBound) return;
        engineBroadcastBound = true;
        engine.subscribe(snapshot => {
            recordRaceSnapshot(snapshot);
            wss.clients.forEach(client => sendClient(client, snapshot));
        });
    };

    const ensureDriverEngineSubscription = (ws: WebSocket, driver: number) => {
        const unsubscribers = clientUnsubscribers.get(ws);
        if (!unsubscribers || unsubscribers.has(driver)) return;

        const unsubscribe = engine.subscribeDriver(driver, payload => {
            sendClient(ws, payload);
        }, false);
        unsubscribers.set(driver, unsubscribe);
    };

    wss.on('connection', ws => {
        clientDriverSubs.set(ws, new Set());
        clientUnsubscribers.set(ws, new Map());
        clientDelayMs.set(ws, 0);
        clientDelaySessionKey.set(ws, null);
        clientDelayTimers.set(ws, new Set());

        // Give the browser a brief opportunity to restore its session-specific
        // Broadcast Sync setting before sending the initial live snapshot.
        const initialSnapshotTimer = setTimeout(() => {
            if (!clientConfiguredDelay.has(ws)) sendCurrentClientState(ws);
        }, 250);

        ws.on('message', raw => {
            try {
                const message = JSON.parse(raw.toString());
                const driver = Number(message.driver);

                if (message.type === 'SET_BROADCAST_DELAY') {
                    const seconds = Math.max(0, Math.min(120, Number(message.seconds) || 0));
                    const requestedSessionKey = message.sessionKey != null ? String(message.sessionKey) : null;

                    clientConfiguredDelay.add(ws);
                    clearTimeout(initialSnapshotTimer);
                    clearClientDelayTimers(ws);
                    clientDelayMs.set(ws, seconds * 1000);
                    clientDelaySessionKey.set(
                        ws,
                        requestedSessionKey
                            || clientDelaySessionKey.get(ws)
                            || (engine.getSnapshot()?.sessionKey != null ? String(engine.getSnapshot().sessionKey) : null)
                    );

                    sendClient(ws, {
                        type: 'BROADCAST_DELAY_APPLIED',
                        seconds,
                        sessionKey: clientDelaySessionKey.get(ws)
                    }, true);

                    // Start presentation immediately at T-delay, then replay the
                    // already-buffered race/tracker snapshots at their original
                    // cadence until they meet the normal delayed live stream.
                    replayBufferedRaceState(ws, seconds * 1000);

                    // Existing driver subscriptions still get a delay-aligned
                    // bootstrap immediately; future driver telemetry continues
                    // through the normal delayed stream/fallback path.
                    const driverCutoffMs = seconds > 0
                        ? Date.now() - (seconds * 1000)
                        : undefined;
                    for (const driver of clientDriverSubs.get(ws) || []) {
                        sendClient(
                            ws,
                            engine.getDriverSnapshot(driver, true, driverCutoffMs),
                            true
                        );
                    }
                    return;
                }

                if ((message.type === 'SUBSCRIBE_DRIVER' || message.type === 'SUBSCRIBE_TELEMETRY') && Number.isFinite(driver)) {
                    const subs = clientDriverSubs.get(ws)!;
                    if (subs.has(driver)) return;

                    subs.add(driver);

                    const delayMs = Math.max(0, clientDelayMs.get(ws) || 0);
                    const cutoffMs = delayMs > 0 ? Date.now() - delayMs : undefined;

                    // A driver route may be opened after Broadcast Sync is already
                    // active. Do not make that page sit empty for the full delay
                    // window. The engine already retains raw car/lap/location
                    // history, so bootstrap the page immediately at T-delay, then
                    // continue with normally delayed live updates.
                    const bootstrapSnapshot = engine.getDriverSnapshot(driver, true, cutoffMs);
                    sendClient(ws, bootstrapSnapshot, true);

                    if (delayMs > 0 && cutoffMs) {
                        const replayPoints = engine.getDriverTelemetryReplay(driver, cutoffMs, Date.now());

                        for (const point of replayPoints) {
                            const pointTime = point?.date ? new Date(point.date).getTime() : NaN;
                            if (!Number.isFinite(pointTime)) continue;

                            const offset = Math.max(0, pointTime - cutoffMs);
                            if (offset > delayMs) continue;

                            scheduleClientPayload(
                                ws,
                                JSON.stringify({
                                    type: 'LIVE_TELEMETRY_POINT',
                                    sessionKey: clientDelaySessionKey.get(ws)
                                        || (engine.getSnapshot()?.sessionKey != null
                                            ? String(engine.getSnapshot().sessionKey)
                                            : null),
                                    driver,
                                    timestamp: Date.now(),
                                    data: point
                                }),
                                offset
                            );
                        }
                    }

                    // In production the backend may have joined the MQTT session
                    // after this driver's recent car_data samples were published.
                    // MQTT only provides future events, so the retained engine
                    // history can legitimately be empty even though laps/results
                    // are already populated. Bootstrap that missing telemetry once
                    // from OpenF1 REST, still entirely through the backend.
                    if (
                        !Array.isArray(bootstrapSnapshot?.data?.telemetry)
                        || bootstrapSnapshot.data.telemetry.length === 0
                    ) {
                        const activeKey = engine.getSnapshot()?.sessionKey;
                        if (activeKey != null) {
                            void getCleanTelemetry(String(activeKey), driver, undefined, true)
                                .then(history => {
                                    const delayedTelemetry = Array.isArray(history?.telemetry)
                                        ? history.telemetry.filter((point: any) => {
                                            if (!cutoffMs) return true;
                                            const time = point?.date ? new Date(point.date).getTime() : NaN;
                                            return Number.isFinite(time) && time <= cutoffMs;
                                        })
                                        : [];

                                    const delayedLaps = Array.isArray(history?.laps)
                                        ? history.laps.filter((lap: any) => {
                                            if (!cutoffMs) return true;
                                            const start = lap?.date_start ? new Date(lap.date_start).getTime() : NaN;
                                            return Number.isFinite(start) && start <= cutoffMs;
                                        })
                                        : [];

                                    const latestLapX = delayedTelemetry.length > 0
                                        ? Number(delayedTelemetry[delayedTelemetry.length - 1]?.lapX)
                                        : NaN;
                                    const latestLap = Number.isFinite(latestLapX)
                                        ? Math.max(1, Math.floor(latestLapX))
                                        : Math.max(
                                            0,
                                            ...delayedLaps.map((lap: any) => Number(lap.lap_number || 0))
                                        );

                                    const delayedStints = Array.isArray(history?.stints)
                                        ? history.stints.filter((stint: any) =>
                                            Number(stint?.lap_start || 0) <= latestLap
                                        )
                                        : [];

                                    if (delayedTelemetry.length === 0) return;

                                    sendClient(ws, {
                                        type: 'LIVE_DRIVER_STATE',
                                        sessionKey: String(activeKey),
                                        driver,
                                        timestamp: Date.now(),
                                        data: {
                                            driver: bootstrapSnapshot?.data?.driver || null,
                                            telemetry: delayedTelemetry,
                                            laps: delayedLaps,
                                            stints: delayedStints
                                        }
                                    }, true);

                                    if (cutoffMs) {
                                        const now = Date.now();
                                        const futurePoints = (history?.telemetry || []).filter((point: any) => {
                                            const time = point?.date ? new Date(point.date).getTime() : NaN;
                                            return Number.isFinite(time) && time > cutoffMs && time <= now;
                                        });

                                        for (const point of futurePoints) {
                                            const pointTime = new Date(point.date).getTime();
                                            const offset = Math.max(0, pointTime - cutoffMs);
                                            if (offset > delayMs) continue;

                                            scheduleClientPayload(
                                                ws,
                                                JSON.stringify({
                                                    type: 'LIVE_TELEMETRY_POINT',
                                                    sessionKey: String(activeKey),
                                                    driver,
                                                    timestamp: Date.now(),
                                                    data: point
                                                }),
                                                offset
                                            );
                                        }
                                    }
                                })
                                .catch(error => {
                                    console.warn(
                                        `⚠️ Unable to REST-bootstrap live telemetry for driver ${driver}:`,
                                        error?.message || error
                                    );
                                });
                        }
                    }

                    ensureDriverEngineSubscription(ws, driver);

                    if (providerReady && provider) provider.subscribeDriver(driver);
                }

                if ((message.type === 'UNSUBSCRIBE_DRIVER' || message.type === 'UNSUBSCRIBE_TELEMETRY') && Number.isFinite(driver)) {
                    clientDriverSubs.get(ws)?.delete(driver);
                    clientUnsubscribers.get(ws)?.get(driver)?.();
                    clientUnsubscribers.get(ws)?.delete(driver);

                    const stillUsed = Array.from(clientDriverSubs.values()).some(set => set.has(driver));
                    if (!stillUsed && providerReady && provider) provider.unsubscribeDriver(driver);
                }
            } catch (error) {
                console.error('Error handling WebSocket message:', error);
            }
        });

        ws.on('close', () => {
            const subs = clientDriverSubs.get(ws);
            const unsubscribers = clientUnsubscribers.get(ws);
            clientDriverSubs.delete(ws);
            clientUnsubscribers.delete(ws);
            clientConfiguredDelay.delete(ws);
            clearClientDelayTimers(ws);
            clientDelayTimers.delete(ws);
            clientDelayMs.delete(ws);
            clientDelaySessionKey.delete(ws);

            for (const driver of subs || []) {
                unsubscribers?.get(driver)?.();
                const stillUsed = Array.from(clientDriverSubs.values()).some(set => set.has(driver));
                if (!stillUsed && providerReady && provider) provider.unsubscribeDriver(driver);
            }
        });
    });

    if (CONFIG.LIVE_PROVIDER === 'OPENF1_PAID' && CONFIG.OPENF1_USERNAME && CONFIG.OPENF1_PASSWORD) {
        provider = new OpenF1PaidProvider(
            CONFIG.OPENF1_USERNAME,
            CONFIG.OPENF1_PASSWORD,
            CONFIG.OPENF1_BASE,
            CONFIG.OPENF1_TOKEN_URL
        );
    } else {
        provider = new FreeFastF1Provider(CONFIG.FASTF1_WS_URL);
    }

    // Live pages remain browser-WebSocket-only. Resolve the session that is
    // actually active by wall-clock time; OpenF1's "latest" can still refer to
    // the previous completed session until new session data has propagated.
    let hydratedSessionKey: string | null = null;

    const hydrateCurrentSession = async (allowLatestFallback = false) => {
        try {
            const currentSession = await getCurrentLiveSession();
            const sessionKey = currentSession?.session_key != null
                ? String(currentSession.session_key)
                : null;

            if (sessionKey && sessionKey !== hydratedSessionKey) {
                const current = await getRaceDetails(sessionKey, true);
                engine.hydrate(current, sessionKey);
                hydratedSessionKey = sessionKey;
                console.log(`🏁 [Live Engine] Hydrated active session ${sessionKey} (${currentSession.session_name || currentSession.session_type || 'session'}).`);
                broadcastSnapshot();
                return;
            }

            if (!sessionKey && allowLatestFallback && !hydratedSessionKey) {
                const latest = await getRaceDetails('latest', true);
                const latestKey = latest.active_session_key ?? latest.sessionInfo?.session_key;
                if (latestKey != null) {
                    hydratedSessionKey = String(latestKey);
                    engine.hydrate(latest, latestKey);
                    console.log('🏁 [Live Engine] No active wall-clock session; hydrated latest session as fallback.');
                    broadcastSnapshot();
                }
            }
        } catch (error: any) {
            console.warn('⚠️ [Live Engine] REST live-session hydration failed; continuing stream-only:', error?.message || error);
        }
    };

    if (CONFIG.LIVE_PROVIDER === 'OPENF1_PAID') {
        await hydrateCurrentSession(true);
    }

    attachEngineBroadcast();

    await provider.connect({
        onStreamData: (topic, data) => {
            engine.ingest(topic, data);

            if (topic === 'sessions') {
                const rows = Array.isArray(data) ? data : [data];
                const latestSession = rows[rows.length - 1];
                const sessionKey = latestSession?.session_key != null ? String(latestSession.session_key) : null;
                const sessionType = String(latestSession?.session_type || latestSession?.session_name || '').toLowerCase();

                if (sessionKey && sessionKey !== hydratedSessionKey) {
                    void getRaceDetails(sessionKey, true)
                        .then(current => {
                            engine.hydrate(current, sessionKey);
                            hydratedSessionKey = sessionKey;
                            broadcastSnapshot();
                        })
                        .catch(error => console.warn('⚠️ Unable to hydrate newly announced live session:', error?.message || error));
                }

                if (
                    sessionKey
                    && sessionKey !== lapCountSessionKey
                    && (sessionType.includes('race') || sessionType.includes('sprint'))
                ) {
                    lapCountSessionKey = sessionKey;
                    void getScheduledTotalLaps(latestSession)
                        .then(total => engine.setScheduledTotalLaps(total))
                        .catch(error => console.warn('⚠️ Unable to refresh scheduled lap count:', error?.message || error));
                }
            }
        },
        onTelemetry: (driverNumber, point) => {
            if (CONFIG.LIVE_PROVIDER !== 'OPENF1_PAID') {
                for (const [ws, subs] of clientDriverSubs) {
                    if (ws.readyState === WebSocket.OPEN && subs.has(driverNumber)) {
                        sendClient(ws, {
                            type: 'LIVE_TELEMETRY_POINT',
                            driver: driverNumber,
                            data: point
                        });
                    }
                }
            }
        },
        onError: err => console.error(`[${provider?.name || 'Live Provider'} Error]:`, err?.message || err)
    });

    providerReady = true;

    // Driver subscriptions can arrive before provider initialization completes.
    // Apply all queued intents now so telemetry starts without a browser reload.
    const activeDrivers = new Set<number>();
    for (const subs of clientDriverSubs.values()) {
        for (const driver of subs) activeDrivers.add(driver);
    }
    for (const driver of activeDrivers) provider.subscribeDriver(driver);

    broadcastSnapshot();
    console.log(`🏎️ [Live Engine] Backend WebSocket state stream ready using ${provider.name}`);

    // MQTT only pushes future events; if the backend was already running before
    // a session started, there is no guarantee that a fresh sessions message is
    // replayed. Re-resolve the active session periodically so /live rolls over
    // automatically without a backend/browser restart.
    if (CONFIG.LIVE_PROVIDER === 'OPENF1_PAID') {
        setInterval(() => {
            void hydrateCurrentSession(false);
        }, 30000);

        let fallbackPolling = false;
        setInterval(() => {
            if (fallbackPolling) return;

            const subscribedClients = [...clientDriverSubs.entries()]
                .filter(([client, drivers]) => client.readyState === WebSocket.OPEN && drivers.size > 0);
            if (subscribedClients.length === 0) return;

            const staleDrivers = new Set<number>();
            const now = Date.now();

            for (const [, drivers] of subscribedClients) {
                for (const driver of drivers) {
                    const lastIngestedAt = engine.getDriverCarDataIngestedAt(driver);
                    if (!lastIngestedAt || now - lastIngestedAt > 5000) {
                        staleDrivers.add(driver);
                    }
                }
            }

            if (staleDrivers.size === 0) return;

            const activeKey = engine.getSnapshot()?.sessionKey;
            if (activeKey == null) return;

            fallbackPolling = true;

            Promise.all(
                [...staleDrivers].map(async driver => {
                    try {
                        const history = await getCleanTelemetry(String(activeKey), driver, undefined, true);

                        for (const [client, drivers] of subscribedClients) {
                            if (!drivers.has(driver) || client.readyState !== WebSocket.OPEN) continue;

                            const delayMs = Math.max(0, clientDelayMs.get(client) || 0);
                            const cutoffMs = delayMs > 0 ? Date.now() - delayMs : undefined;

                            const telemetry = Array.isArray(history?.telemetry)
                                ? history.telemetry.filter((point: any) => {
                                    if (!cutoffMs) return true;
                                    const time = point?.date ? new Date(point.date).getTime() : NaN;
                                    return Number.isFinite(time) && time <= cutoffMs;
                                })
                                : [];

                            if (telemetry.length === 0) continue;

                            const laps = Array.isArray(history?.laps)
                                ? history.laps.filter((lap: any) => {
                                    if (!cutoffMs) return true;
                                    const start = lap?.date_start ? new Date(lap.date_start).getTime() : NaN;
                                    return Number.isFinite(start) && start <= cutoffMs;
                                })
                                : [];

                            const latestLapX = Number(telemetry[telemetry.length - 1]?.lapX);
                            const latestLap = Number.isFinite(latestLapX)
                                ? Math.max(1, Math.floor(latestLapX))
                                : Math.max(
                                    0,
                                    ...laps.map((lap: any) => Number(lap.lap_number || 0))
                                );

                            const stints = Array.isArray(history?.stints)
                                ? history.stints.filter((stint: any) =>
                                    Number(stint?.lap_start || 0) <= latestLap
                                )
                                : [];

                            const latestRace = engine.getSnapshot()?.data;
                            const driverInfo = latestRace?.results?.find(
                                (result: any) => Number(result.driver_number) === driver
                            ) || null;

                            // This payload is already sampled at T-delay, so send
                            // immediately. Applying sendClient's delay again would
                            // double-delay the fallback.
                            sendClient(client, {
                                type: 'LIVE_DRIVER_STATE',
                                sessionKey: String(activeKey),
                                driver,
                                timestamp: Date.now(),
                                data: {
                                    driver: driverInfo,
                                    telemetry,
                                    laps,
                                    stints
                                }
                            }, true);
                        }
                    } catch (error: any) {
                        console.warn(
                            `⚠️ Live telemetry fallback poll failed for driver ${driver}:`,
                            error?.message || error
                        );
                    }
                })
            ).finally(() => {
                fallbackPolling = false;
            });
        }, 2500);
    }
};
