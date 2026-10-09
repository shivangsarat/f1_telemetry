import { WebSocketServer, WebSocket } from 'ws';
import { CONFIG } from '../config';
import { ITelemetryProvider } from '../providers/ITelemetryProvider';
import { FreeFastF1Provider } from '../providers/FreeFastF1Provider';
import { OpenF1PaidProvider } from '../providers/OpenF1PaidProvider';
import { LiveSessionEngine } from '../services/liveSessionEngine';
import { getCurrentLiveSession, getRaceDetails, getScheduledTotalLaps } from '../services/dataService';
import { BroadcastSyncHub } from './BroadcastSyncHub';

export const setupWebSocket = async (server: any) => {
    const wss = new WebSocketServer({ server });
    const engine = new LiveSessionEngine();

    // One centralized presentation timeline owns delay for race state, tracker
    // state, driver state and telemetry. Individual pages do not schedule their
    // own timers and no message creates its own setTimeout.
    const syncHub = new BroadcastSyncHub(130_000, 250);
    const clientDriverSubs = new Map<WebSocket, Set<number>>();
    const configuredClients = new Set<WebSocket>();
    const driverStateSubscriptions = new Map<number, () => void>();

    let provider: ITelemetryProvider | null = null;
    let providerReady = false;
    let engineBroadcastBound = false;
    let lapCountSessionKey: string | null = null;

    const sendImmediate = (client: WebSocket, message: any) => {
        if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message));
    };

    const delayedDriverInfo = (targetMs: number, driver: number) => {
        const raceEntry = syncHub.getRaceAtOrBefore(targetMs);
        return raceEntry?.message?.data?.results?.find(
            (result: any) => Number(result.driver_number) === driver
        ) || null;
    };

    const sendDriverBootstrap = (client: WebSocket, driver: number) => {
        if (client.readyState !== WebSocket.OPEN) return;

        const targetMs = syncHub.getPresentationTime(client);
        const snapshot = engine.getDriverSnapshotAt(driver, true, targetMs);
        const driverAtCutoff = delayedDriverInfo(targetMs, driver);

        sendImmediate(client, {
            ...snapshot,
            timestamp: targetMs,
            data: {
                ...snapshot.data,
                driver: driverAtCutoff || snapshot.data?.driver || null
            }
        });
    };

    const sendRaceBootstrap = (client: WebSocket) => {
        if (client.readyState !== WebSocket.OPEN) return;

        const targetMs = syncHub.getPresentationTime(client);
        const buffered = syncHub.getRaceAtOrBefore(targetMs);
        const current = engine.getSnapshot();
        const base = buffered?.message || current;

        // The hub deliberately strips the static trace from buffered frames.
        // Reconstruct it once at the presentation cutoff for race, mini-map and
        // full tracker pages; subsequent compact frames preserve it client-side.
        sendImmediate(client, {
            ...base,
            timestamp: targetMs,
            data: {
                ...(base?.data || current?.data || {}),
                tracker: engine.getTrackerSnapshotAt(targetMs)
            }
        });
    };

    const bootstrapClient = (client: WebSocket) => {
        sendRaceBootstrap(client);
        for (const driver of syncHub.getSubscribedDrivers(client)) {
            sendDriverBootstrap(client, driver);
        }
    };

    const broadcastSnapshot = () => {
        syncHub.recordRace(engine.getSnapshot());
    };

    const attachEngineBroadcast = () => {
        if (engineBroadcastBound) return;
        engineBroadcastBound = true;

        engine.subscribe(snapshot => {
            syncHub.recordRace(snapshot);
        });

        // Paid OpenF1 car_data is ingested for every driver, so this listener
        // continuously warms the telemetry history before a driver page opens.
        engine.subscribeTelemetry(payload => {
            syncHub.recordTelemetry(payload);
        });
    };

    const ensureDriverStateSubscription = (driver: number) => {
        if (driverStateSubscriptions.has(driver)) return;

        const unsubscribe = engine.subscribeDriver(driver, payload => {
            // Telemetry is recorded by subscribeTelemetry above. This listener is
            // only for lower-frequency lap/stint/driver snapshots.
            if (payload?.type === 'LIVE_DRIVER_STATE') {
                syncHub.recordDriverState({
                    ...payload,
                    data: {
                        ...payload.data,
                        telemetry: undefined
                    }
                });
            }
        });
        driverStateSubscriptions.set(driver, unsubscribe);
    };

    const releaseDriverStateSubscriptionIfUnused = (driver: number) => {
        const stillUsed = Array.from(clientDriverSubs.values()).some(set => set.has(driver));
        if (stillUsed) return;

        driverStateSubscriptions.get(driver)?.();
        driverStateSubscriptions.delete(driver);

        if (providerReady && provider) provider.unsubscribeDriver(driver);
    };

    // A single scheduler advances every connected browser along the same source
    // timeline. Delay changes reset cursors; they never create per-event timers.
    const presentationTimer = setInterval(() => {
        syncHub.flush();
    }, 100);
    if (typeof (presentationTimer as any).unref === 'function') {
        (presentationTimer as any).unref();
    }

    wss.on('connection', ws => {
        clientDriverSubs.set(ws, new Set());
        syncHub.registerClient(ws);

        // New clients normally configure delay immediately in WebSocket.onopen.
        // Keep a small compatibility fallback so an older frontend still starts.
        const bootstrapFallback = setTimeout(() => {
            if (configuredClients.has(ws) || ws.readyState !== WebSocket.OPEN) return;
            syncHub.configureDelay(ws, 0);
            bootstrapClient(ws);
        }, 750);

        ws.on('message', raw => {
            try {
                const message = JSON.parse(raw.toString());
                const driver = Number(message.driver);

                if (message.type === 'SET_BROADCAST_DELAY') {
                    const seconds = Math.max(0, Math.min(120, Number(message.seconds) || 0));
                    configuredClients.add(ws);
                    clearTimeout(bootstrapFallback);

                    syncHub.configureDelay(ws, seconds);
                    sendImmediate(ws, {
                        type: 'BROADCAST_DELAY_APPLIED',
                        seconds
                    });
                    bootstrapClient(ws);
                    return;
                }

                if ((message.type === 'SUBSCRIBE_DRIVER' || message.type === 'SUBSCRIBE_TELEMETRY') && Number.isFinite(driver)) {
                    const subs = clientDriverSubs.get(ws)!;
                    if (subs.has(driver)) return;

                    subs.add(driver);
                    syncHub.subscribeDriver(ws, driver);
                    ensureDriverStateSubscription(driver);

                    // Start this page immediately at T-delay. Because telemetry is
                    // globally buffered, the 100 ms presentation loop can continue
                    // from this point without waiting the configured delay again.
                    sendDriverBootstrap(ws, driver);

                    if (providerReady && provider) provider.subscribeDriver(driver);
                    return;
                }

                if ((message.type === 'UNSUBSCRIBE_DRIVER' || message.type === 'UNSUBSCRIBE_TELEMETRY') && Number.isFinite(driver)) {
                    clientDriverSubs.get(ws)?.delete(driver);
                    syncHub.unsubscribeDriver(ws, driver);
                    releaseDriverStateSubscriptionIfUnused(driver);
                }
            } catch (error) {
                console.error('Error handling WebSocket message:', error);
            }
        });

        ws.on('close', () => {
            clearTimeout(bootstrapFallback);
            configuredClients.delete(ws);

            const subs = clientDriverSubs.get(ws) || new Set<number>();
            clientDriverSubs.delete(ws);
            syncHub.unregisterClient(ws);

            for (const driver of subs) {
                releaseDriverStateSubscriptionIfUnused(driver);
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
            // FreeFastF1 delivers telemetry outside the engine's car_data topic,
            // so feed it into the same centralized presentation buffer here.
            if (CONFIG.LIVE_PROVIDER !== 'OPENF1_PAID') {
                const snapshot = engine.getSnapshot();
                syncHub.recordTelemetry({
                    type: 'LIVE_TELEMETRY_POINT',
                    sessionKey: snapshot?.sessionKey ?? null,
                    timestamp: Date.now(),
                    driver: driverNumber,
                    data: point
                });
            }
        },
        onError: err => console.error(`[${provider?.name || 'Live Provider'} Error]:`, err?.message || err)
    });

    providerReady = true;

    // Driver subscriptions can arrive before provider initialization completes.
    const activeDrivers = new Set<number>();
    for (const subs of clientDriverSubs.values()) {
        for (const driver of subs) activeDrivers.add(driver);
    }
    for (const driver of activeDrivers) provider.subscribeDriver(driver);

    broadcastSnapshot();
    console.log(`🏎️ [Live Engine] Backend WebSocket state stream ready using ${provider.name}`);

    // MQTT only pushes future events; periodically re-resolve the active session
    // so /live rolls over without requiring a restart.
    if (CONFIG.LIVE_PROVIDER === 'OPENF1_PAID') {
        setInterval(() => {
            void hydrateCurrentSession(false);
        }, 30000);
    }
};
