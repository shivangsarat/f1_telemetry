import { WebSocket } from 'ws';
import { ITelemetryProvider, TelemetryCallbacks } from './ITelemetryProvider';

export class MockOpenF1Provider implements ITelemetryProvider {
    name = 'Mock OpenF1 Live Replay';
    private wsUrl: string;
    private ws: WebSocket | null = null;
    private callbacks: TelemetryCallbacks | null = null;
    private subscribedDrivers = new Set<number>();

    constructor(wsUrl: string) {
        this.wsUrl = wsUrl;
    }

    async connect(callbacks: TelemetryCallbacks): Promise<void> {
        this.callbacks = callbacks;

        await new Promise<void>((resolve, reject) => {
            this.ws = new WebSocket(this.wsUrl);

            const onOpen = () => {
                this.ws?.off('error', onError);
                resolve();
            };
            const onError = (error: Error) => {
                this.ws?.off('open', onOpen);
                reject(error);
            };

            this.ws.once('open', onOpen);
            this.ws.once('error', onError);

            this.ws.on('message', raw => {
                try {
                    const envelope = JSON.parse(raw.toString());
                    const topic = String(envelope.topic || '').replace(/^v1\//, '');
                    const data = envelope.data;

                    if (!topic) return;

                    this.callbacks?.onStreamData?.(topic, data);

                    const rows = Array.isArray(data) ? data : [data];
                    if (topic === 'race_control') rows.forEach(row => this.callbacks?.onRaceControl?.(row));
                    if (topic === 'intervals') rows.forEach(row => this.callbacks?.onInterval?.(row));
                    if (topic === 'position') rows.forEach(row => this.callbacks?.onPosition?.(row));
                    if (topic === 'weather') rows.forEach(row => this.callbacks?.onWeather?.(row));
                } catch (error) {
                    this.callbacks?.onError?.(error);
                }
            });

            this.ws.on('error', error => this.callbacks?.onError?.(error));
            this.ws.on('close', () => {
                this.ws = null;
            });
        });
    }

    subscribeDriver(driverNumber: number) {
        this.subscribedDrivers.add(driverNumber);
    }

    unsubscribeDriver(driverNumber: number) {
        this.subscribedDrivers.delete(driverNumber);
    }

    disconnect() {
        this.ws?.close();
        this.ws = null;
        this.subscribedDrivers.clear();
    }
}
