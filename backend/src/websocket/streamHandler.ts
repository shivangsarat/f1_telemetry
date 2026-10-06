import { WebSocketServer, WebSocket } from 'ws';
import { CONFIG } from '../config';
import { ITelemetryProvider } from '../providers/ITelemetryProvider';
import { FreeFastF1Provider } from '../providers/FreeFastF1Provider';
import { OpenF1PaidProvider } from '../providers/OpenF1PaidProvider';
import { MockOpenF1Provider } from '../providers/MockOpenF1Provider';
import { startMockOpenF1Server } from '../mock/MockOpenF1ReplayServer';
import { LiveSessionEngine } from '../services/liveSessionEngine';
import { getRaceDetails } from '../services/dataService';

export const setupWebSocket = async (server: any) => {
    // Attach WebSocket handling immediately. Provider/bootstrap initialization may
    // take time (especially mock historical telemetry preparation), but browser
    // connections and driver subscription intents should never be lost.
    const wss = new WebSocketServer({ server });
    const engine = new LiveSessionEngine();

    const clientDriverSubs = new Map<WebSocket, Set<number>>();
    const clientUnsubscribers = new Map<WebSocket, Map<number, () => void>>();

    let provider: ITelemetryProvider | null = null;
    let providerReady = false;
    let engineBroadcastBound = false;

    const broadcastSnapshot = () => {
        const payload = JSON.stringify(engine.getSnapshot());
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) client.send(payload);
        });
    };

    const attachEngineBroadcast = () => {
        if (engineBroadcastBound) return;
        engineBroadcastBound = true;
        engine.subscribe(snapshot => {
            const payload = JSON.stringify(snapshot);
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) client.send(payload);
            });
        });
    };

    const ensureDriverEngineSubscription = (ws: WebSocket, driver: number) => {
        const unsubscribers = clientUnsubscribers.get(ws);
        if (!unsubscribers || unsubscribers.has(driver)) return;

        const unsubscribe = engine.subscribeDriver(driver, payload => {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
        });
        unsubscribers.set(driver, unsubscribe);
    };

    wss.on('connection', ws => {
        clientDriverSubs.set(ws, new Set());
        clientUnsubscribers.set(ws, new Map());

        // Once provider/bootstrap state exists this snapshot is useful immediately.
        // During initialization it is harmless and later gets replaced by the
        // hydrated snapshot broadcast.
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(engine.getSnapshot()));
        }

        ws.on('message', raw => {
            try {
                const message = JSON.parse(raw.toString());
                const driver = Number(message.driver);

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

            for (const driver of subs || []) {
                unsubscribers?.get(driver)?.();
                const stillUsed = Array.from(clientDriverSubs.values()).some(set => set.has(driver));
                if (!stillUsed && providerReady && provider) provider.unsubscribeDriver(driver);
            }
        });
    });

    if (CONFIG.USE_MOCK_OPENF1) {
        await startMockOpenF1Server();
        provider = new MockOpenF1Provider(`ws://localhost:${CONFIG.MOCK_OPENF1_PORT}/stream`);
    } else if (CONFIG.LIVE_PROVIDER === 'OPENF1_PAID' && CONFIG.OPENF1_USERNAME && CONFIG.OPENF1_PASSWORD) {
        provider = new OpenF1PaidProvider(
            CONFIG.OPENF1_USERNAME,
            CONFIG.OPENF1_PASSWORD,
            CONFIG.OPENF1_BASE,
            CONFIG.OPENF1_TOKEN_URL
        );
    } else {
        provider = new FreeFastF1Provider(CONFIG.FASTF1_WS_URL);
    }

    // Live mode intentionally does not make a browser REST call. The backend
    // hydrates once, then the browser receives that state over our WebSocket.
    if (CONFIG.USE_MOCK_OPENF1 || CONFIG.LIVE_PROVIDER === 'OPENF1_PAID') {
        try {
            const initial = await getRaceDetails('latest');
            engine.hydrate(initial, initial.active_session_key ?? initial.sessionInfo?.session_key);
            console.log('🏁 [Live Engine] Initial live state hydrated from REST.');
            broadcastSnapshot();
        } catch (error: any) {
            console.warn('⚠️ [Live Engine] REST hydration failed; continuing stream-only:', error?.message || error);
        }
    }

    attachEngineBroadcast();

    await provider.connect({
        onStreamData: (topic, data) => engine.ingest(topic, data),
        onTelemetry: (driverNumber, point) => {
            if (!CONFIG.USE_MOCK_OPENF1 && CONFIG.LIVE_PROVIDER !== 'OPENF1_PAID') {
                for (const [ws, subs] of clientDriverSubs) {
                    if (ws.readyState === WebSocket.OPEN && subs.has(driverNumber)) {
                        ws.send(JSON.stringify({
                            type: 'LIVE_TELEMETRY_POINT',
                            driver: driverNumber,
                            data: point
                        }));
                    }
                }
            }
        },
        onError: err => console.error(`[${provider?.name || 'Live Provider'} Error]:`, err?.message || err)
    });

    providerReady = true;

    // Subscriptions can arrive while the provider is still initializing. Apply
    // all queued intents now so driver telemetry starts without a browser reload.
    const activeDrivers = new Set<number>();
    for (const subs of clientDriverSubs.values()) {
        for (const driver of subs) activeDrivers.add(driver);
    }
    for (const driver of activeDrivers) provider.subscribeDriver(driver);

    broadcastSnapshot();
    console.log(`🏎️ [Live Engine] Backend WebSocket state stream ready using ${provider.name}`);
};
