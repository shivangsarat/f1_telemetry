import { WebSocketServer, WebSocket } from 'ws';
import { getCleanTelemetry, getRaceDetails, getRaceControl } from '../services/dataService';

export const setupWebSocket = (server: any) => {
    const wss = new WebSocketServer({ server });
    const subscriptions = new Map<number, Set<WebSocket>>();
    const timers = new Map<number, NodeJS.Timeout>();
    let isRateLimited = false;

    setInterval(async () => {
        if (wss.clients.size === 0 || isRateLimited) return;
        try {
            const data = await getRaceDetails('latest'); 
            const rcData = await getRaceControl('latest'); 
            const payload = JSON.stringify({ type: 'GLOBAL_TICK', data, raceControl: rcData });
            wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(payload); });
        } catch (e: any) {
            if (e.response?.status === 429) { isRateLimited = true; setTimeout(() => { isRateLimited = false; }, 10000); }
        }
    }, 5000);

    const pollTelemetry = async (driverNumber: number, sinceTimestamp?: string) => {
        const clients = subscriptions.get(driverNumber);
        if (!clients || clients.size === 0) {
            clearInterval(timers.get(driverNumber));
            timers.delete(driverNumber);
            return;
        }
        if (isRateLimited) return;

        try {
            const payloadData = await getCleanTelemetry('latest', driverNumber, sinceTimestamp);
            if (payloadData.telemetry.length > 0) {
                const payload = JSON.stringify({ type: 'TELEMETRY_UPDATE', driver: driverNumber, data: payloadData });
                clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(payload); });
            }
        } catch (e: any) {
            if (e.response?.status === 429) { isRateLimited = true; setTimeout(() => { isRateLimited = false; }, 10000); }
        }
    };

    wss.on('connection', (ws) => {
        ws.on('message', (msg) => {
            const { type, driver, since } = JSON.parse(msg.toString());
            if (type === 'SUBSCRIBE_TELEMETRY') {
                if (!subscriptions.has(driver)) subscriptions.set(driver, new Set());
                subscriptions.get(driver)!.add(ws);
                pollTelemetry(driver, since);
                if (!timers.has(driver)) timers.set(driver, setInterval(() => pollTelemetry(driver), 1000));
            }
            if (type === 'UNSUBSCRIBE_TELEMETRY') subscriptions.get(driver)?.delete(ws);
        });
        ws.on('close', () => subscriptions.forEach(clients => clients.delete(ws)));
    });
};