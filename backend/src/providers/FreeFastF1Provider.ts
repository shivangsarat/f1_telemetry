import { WebSocket } from 'ws';
import { ITelemetryProvider, TelemetryCallbacks } from './ITelemetryProvider';

export class FreeFastF1Provider implements ITelemetryProvider {
    name = 'Free Local FastF1 / Decoder';
    private wsUrl: string;
    private ws: WebSocket | null = null;
    private callbacks: TelemetryCallbacks | null = null;
    private subscribedDrivers = new Set<number>();
    private telemetryStartTime = new Map<number, number>();

    constructor(wsUrl = 'ws://localhost:8082') {
        this.wsUrl = wsUrl;
    }

    async connect(callbacks: TelemetryCallbacks): Promise<void> {
        this.callbacks = callbacks;

        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.wsUrl);

            this.ws.on('open', () => {
                console.log(`🔌 [Live Engine] Connected via ${this.name} on ${this.wsUrl}`);
                resolve();
            });

            this.ws.on('message', raw => {
                try {
                    const data = JSON.parse(raw.toString());

                    if (data.race_control) {
                        this.callbacks?.onStreamData?.('race_control', data.race_control);
                        this.callbacks?.onRaceControl?.(data.race_control);
                    }

                    const lapCount = data.lap_count ?? data.LapCount ?? data.lapCount;
                    if (lapCount) {
                        this.callbacks?.onStreamData?.('lap_count', lapCount);
                    }

                    if (data.telemetry?.Entries) {
                        for (const driverNum of this.subscribedDrivers) {
                            const car = data.telemetry.Entries[0]?.Cars?.[String(driverNum)];
                            if (!car) continue;
                            const ch = car.Channels || {};
                            const now = Date.now();
                            if (!this.telemetryStartTime.has(driverNum)) {
                                this.telemetryStartTime.set(driverNum, now);
                            }
                            const start = this.telemetryStartTime.get(driverNum) || now;

                            this.callbacks?.onTelemetry?.(driverNum, {
                                // The local decoder does not provide normal OpenF1
                                // lap rows here. Keep a small monotonic pre-lap x
                                // coordinate rather than using epoch milliseconds,
                                // which can destabilize uPlot.
                                lapX: Math.min(0.999, Math.max(0, now - start) / (30 * 60 * 1000)),
                                preLap: true,
                                date: new Date(now).toISOString(),
                                speed: Number(ch['2'] || 0),
                                rpm: Number(ch['0'] || 0),
                                gear: Number(ch['3'] || 0),
                                throttle: Number(ch['4'] || 0),
                                brake: Number(ch['5'] || 0)
                            });
                        }
                    }
                } catch (error) {
                    this.callbacks?.onError?.(error);
                }
            });

            this.ws.on('error', error => {
                this.callbacks?.onError?.(error);
                reject(error);
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
        this.telemetryStartTime.clear();
    }
}
