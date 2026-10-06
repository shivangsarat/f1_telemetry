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
    const wss = new WebSocketServer({ server });
    const engine = new LiveSessionEngine();

    const clientDriverSubs = new Map<WebSocket, Set<number>>();
    const clientUnsubscribers = new Map<WebSocket, Map<number, () => void>>();

    let provider: ITelemetryProvider;
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

    // MQTT only delivers messages published after subscription. Hydrate the
    // backend once from REST so a client joining mid-session immediately gets the
    // current race state; all subsequent updates remain WebSocket/MQTT streaming.
    if (CONFIG.USE_MOCK_OPENF1 || CONFIG.LIVE_PROVIDER === 'OPENF1_PAID') {
        try {
            const initial = await getRaceDetails('latest');
            engine.hydrate(initial, initial.active_session_key ?? initial.sessionInfo?.session_key);
            console.log('🏁 [Live Engine] Initial live state hydrated from REST.');
        } catch (error: any) {
            console.warn('⚠️ [Live Engine] REST hydration failed; continuing stream-only:', error?.message || error);
        }
    }

    await provider.connect({
        onStreamData: (topic, data) => engine.ingest(topic, data),
        onTelemetry: (driverNumber, point) => {
            // The provider-level callback is retained for the FastF1 adapter.
            // OpenF1 car_data is also ingested into the engine below via onStreamData.
            if (!CONFIG.USE_MOCK_OPENF1 && CONFIG.LIVE_PROVIDER !== 'OPENF1_PAID') {
                const listeners = clientUnsubscribers;
                for (const [ws, subs] of clientDriverSubs) {
                    if (ws.readyState === WebSocket.OPEN && subs.has(driverNumber)) {
                        ws.send(JSON.stringify({
                            type: 'LIVE_TELEMETRY_POINT',
                            driver: driverNumber,
                            data: point
                        }));
                    }
                }
                void listeners;
            }
        },
        onError: err => console.error(`[${provider.name} Error]:`, err?.message || err)
    });

    engine.subscribe(snapshot => {
        const payload = JSON.stringify(snapshot);
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) client.send(payload);
        });
    });

    wss.on('connection', ws => {
        clientDriverSubs.set(ws, new Set());
        clientUnsubscribers.set(ws, new Map());

        // Immediately hydrate a newly connected live client from the same
        // backend state used for all subsequent streaming updates.
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
                    provider.subscribeDriver(driver);

                    const unsubscribe = engine.subscribeDriver(driver, payload => {
                        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
                    });
                    clientUnsubscribers.get(ws)!.set(driver, unsubscribe);
                }

                if ((message.type === 'UNSUBSCRIBE_DRIVER' || message.type === 'UNSUBSCRIBE_TELEMETRY') && Number.isFinite(driver)) {
                    clientDriverSubs.get(ws)?.delete(driver);
                    clientUnsubscribers.get(ws)?.get(driver)?.();
                    clientUnsubscribers.get(ws)?.delete(driver);

                    const stillUsed = Array.from(clientDriverSubs.values()).some(set => set.has(driver));
                    if (!stillUsed) provider.unsubscribeDriver(driver);
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
                if (!stillUsed) provider.unsubscribeDriver(driver);
            }
        });
    });

    console.log(`🏎️ [Live Engine] Backend WebSocket state stream ready using ${provider.name}`);
};