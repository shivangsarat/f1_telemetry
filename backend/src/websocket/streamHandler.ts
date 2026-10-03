import { WebSocketServer, WebSocket } from 'ws';
import { CONFIG } from '../config';
import { ITelemetryProvider, DriverTelemetryPoint } from '../providers/ITelemetryProvider';
import { FreeFastF1Provider } from '../providers/FreeFastF1Provider';
import { OpenF1PaidProvider } from '../providers/OpenF1PaidProvider';

export const setupWebSocket = async (server: any) => {
    const wss = new WebSocketServer({ server });

    // Tracks which driver numbers each connected WebSocket client is subscribed to
    const clientDriverSubs = new Map<WebSocket, Set<number>>();

    // Rolling window buffer of recent telemetry points per driver number
    const sessionTelemetryCache = new Map<number, DriverTelemetryPoint[]>();

    let provider: ITelemetryProvider;

    // Instantiate provider based on config
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

    const startProvider = async (activeProvider: ITelemetryProvider) => {
        try {
            await activeProvider.connect({
                onTelemetry: (driverNum: number, point: DriverTelemetryPoint) => {
                    if (!sessionTelemetryCache.has(driverNum)) {
                        sessionTelemetryCache.set(driverNum, []);
                    }
                    const driverCache = sessionTelemetryCache.get(driverNum)!;
                    driverCache.push(point);

                    // Maintain the last 150 points for real-time charting without memory leaks
                    if (driverCache.length > 150) {
                        driverCache.shift();
                    }

                    const payload = JSON.stringify({
                        type: 'TELEMETRY_UPDATE',
                        driver: driverNum,
                        data: { telemetry: driverCache }
                    });

                    wss.clients.forEach((client) => {
                        const subs = clientDriverSubs.get(client);
                        if (client.readyState === WebSocket.OPEN && subs && subs.has(driverNum)) {
                            client.send(payload);
                        }
                    });
                },
                onRaceControl: (rcData: any) => {
                    const payload = JSON.stringify({
                        type: 'GLOBAL_TICK',
                        raceControl: rcData
                    });
                    wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(payload);
                        }
                    });
                },
                onError: (err: any) => {
                    console.error(`[${activeProvider.name} Error]:`, err?.message || err);
                }
            });
        } catch (e: any) {
            console.error(`❌ Failed to start provider ${activeProvider.name}:`, e?.message || e);
            // Automatic fallback: If Free provider fails to start and OpenF1 credentials exist, swap
            if (activeProvider instanceof FreeFastF1Provider && CONFIG.OPENF1_USERNAME && CONFIG.OPENF1_PASSWORD) {
                console.warn('⚠️ Free Provider failed to launch. Auto-falling back to OpenF1 Paid...');
                provider = new OpenF1PaidProvider(
                    CONFIG.OPENF1_USERNAME,
                    CONFIG.OPENF1_PASSWORD,
                    CONFIG.OPENF1_BASE,
                    CONFIG.OPENF1_TOKEN_URL
                );
                await startProvider(provider);
            }
        }
    };

    await startProvider(provider);

    wss.on('connection', (ws: WebSocket) => {
        clientDriverSubs.set(ws, new Set());

        ws.on('message', (msg: any) => {
            try {
                const parsed = JSON.parse(msg.toString());
                const { type, driver } = parsed;
                const driverNum = Number(driver);

                if (type === 'SUBSCRIBE_TELEMETRY' && !isNaN(driverNum)) {
                    clientDriverSubs.get(ws)?.add(driverNum);
                    provider.subscribeDriver(driverNum);

                    // Send cached points immediately if available so graphs don't wait for next tick
                    const cached = sessionTelemetryCache.get(driverNum);
                    if (cached && cached.length > 0) {
                        ws.send(JSON.stringify({
                            type: 'TELEMETRY_UPDATE',
                            driver: driverNum,
                            data: { telemetry: cached }
                        }));
                    }
                }

                if (type === 'UNSUBSCRIBE_TELEMETRY' && !isNaN(driverNum)) {
                    clientDriverSubs.get(ws)?.delete(driverNum);

                    // Only tell the provider to stop polling if no other connected tab is watching
                    const anyClientStillSubscribed = Array.from(clientDriverSubs.values()).some((s) => s.has(driverNum));
                    if (!anyClientStillSubscribed) {
                        provider.unsubscribeDriver(driverNum);
                    }
                }
            } catch (err: any) {
                console.error('Error handling WebSocket message:', err?.message || err);
            }
        });

        ws.on('close', () => {
            const subs = clientDriverSubs.get(ws);
            clientDriverSubs.delete(ws);

            // Clean up provider driver listeners if this was the last active client
            if (subs) {
                for (const driverNum of subs) {
                    const anyClientStillSubscribed = Array.from(clientDriverSubs.values()).some((s) => s.has(driverNum));
                    if (!anyClientStillSubscribed) {
                        provider.unsubscribeDriver(driverNum);
                    }
                }
            }
        });
    });
};