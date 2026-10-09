import { WebSocketServer, WebSocket } from 'ws';
import { CONFIG } from '../config';
import { ITelemetryProvider } from '../providers/ITelemetryProvider';
import { FreeFastF1Provider } from '../providers/FreeFastF1Provider';
import { OpenF1PaidProvider } from '../providers/OpenF1PaidProvider';
import { LiveSessionEngine } from '../services/liveSessionEngine';
import { getCurrentLiveSession, getRaceDetails, getScheduledTotalLaps } from '../services/dataService';

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

    const clearClientDelayTimers = (client: WebSocket) => {
        const timers = clientDelayTimers.get(client);
        if (timers) {
            for (const timer of timers) clearTimeout(timer);
            timers.clear();
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

        const timers = clientDelayTimers.get(client) || new Set<ReturnType<typeof setTimeout>>();
        clientDelayTimers.set(client, timers);
        const timer = setTimeout(() => {
            timers.delete(timer);
            if (client.readyState === WebSocket.OPEN) client.send(payload);
        }, delay);
        timers.add(timer);
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
        wss.clients.forEach(client => sendClient(client, snapshot));
    };

    const attachEngineBroadcast = () => {
        if (engineBroadcastBound) return;
        engineBroadcastBound = true;
        engine.subscribe(snapshot => {
            wss.clients.forEach(client => sendClient(client, snapshot));
        });
    };

    const ensureDriverEngineSubscription = (ws: WebSocket, driver: number) => {
        const unsubscribers = clientUnsubscribers.get(ws);
        if (!unsubscribers || unsubscribers.has(driver)) return;

        const unsubscribe = engine.subscribeDriver(driver, payload => {
            sendClient(ws, payload);
        });
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

                    // With no delay this catches the UI up immediately. When a
                    // delay is enabled, this snapshot/driver state becomes the
                    // first item on the delayed presentation timeline.
                    sendCurrentClientState(ws);
                    return;
                }

                if ((message.type === 'SUBSCRIBE_DRIVER' || message.type === 'SUBSCRIBE_TELEMETRY') && Number.isFinite(driver)) {
                    const subs = clientDriverSubs.get(ws)!;
                    if (subs.has(driver)) return;

                    subs.add(driver);
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
    }
};
