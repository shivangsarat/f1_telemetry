import { WebSocketServer, WebSocket } from 'ws';
import { CONFIG } from '../config';
import { ITelemetryProvider, DriverTelemetryPoint } from '../providers/ITelemetryProvider';
import { FreeFastF1Provider } from '../providers/FreeFastF1Provider';
import { OpenF1PaidProvider } from '../providers/OpenF1PaidProvider';

export const setupWebSocket = async (server: any) => {
    const wss = new WebSocketServer({ server });

    const clientDriverSubs = new Map<WebSocket, Set<number>>();
    const sessionTelemetryCache = new Map<number, DriverTelemetryPoint[]>();
    let provider: ITelemetryProvider;

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

                    if (driverCache.length > 150) driverCache.shift();

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
                    const payload = JSON.stringify({ type: 'RACE_CONTROL_UPDATE', data: rcData });
                    wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN) client.send(payload);
                    });
                },
                onInterval: (intervalData: any) => {
                    const payload = JSON.stringify({ type: 'INTERVAL_UPDATE', data: intervalData });
                    wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN) client.send(payload);
                    });
                },
                onPosition: (posData: any) => {
                    const payload = JSON.stringify({ type: 'POSITION_UPDATE', data: posData });
                    wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN) client.send(payload);
                    });
                },
                onWeather: (weatherData: any) => {
                    const payload = JSON.stringify({ type: 'WEATHER_UPDATE', data: weatherData });
                    wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN) client.send(payload);
                    });
                },
                onError: (err: any) => {
                    console.error(`[${activeProvider.name} Error]:`, err?.message || err);
                }
            });
        } catch (e: any) {
            console.error(`❌ Failed to start provider ${activeProvider.name}:`, e?.message || e);
            if (activeProvider instanceof FreeFastF1Provider && CONFIG.OPENF1_USERNAME && CONFIG.OPENF1_PASSWORD) {
                console.warn('⚠️ Free Provider failed to launch. Auto-falling back to OpenF1 Paid...');
                provider = new OpenF1PaidProvider(CONFIG.OPENF1_USERNAME, CONFIG.OPENF1_PASSWORD, CONFIG.OPENF1_BASE, CONFIG.OPENF1_TOKEN_URL);
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

                    const cached = sessionTelemetryCache.get(driverNum);
                    if (cached && cached.length > 0) {
                        ws.send(JSON.stringify({ type: 'TELEMETRY_UPDATE', driver: driverNum, data: { telemetry: cached } }));
                    }
                }

                if (type === 'UNSUBSCRIBE_TELEMETRY' && !isNaN(driverNum)) {
                    clientDriverSubs.get(ws)?.delete(driverNum);

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