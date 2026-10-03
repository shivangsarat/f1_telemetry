import { WebSocket } from 'ws';
import { ITelemetryProvider, TelemetryCallbacks } from './ITelemetryProvider';

export class FreeFastF1Provider implements ITelemetryProvider {
    name = 'Free Local FastF1 / Decoder';
    private wsUrl: string;
    private ws: WebSocket | null = null;
    private callbacks: TelemetryCallbacks | null = null;
    private subscribedDrivers = new Set<number>();

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

            this.ws.on('message', (raw) => {
                try {
                    const data = JSON.parse(raw.toString());
                    
                    if (data.race_control && this.callbacks?.onRaceControl) {
                        this.callbacks.onRaceControl(data.race_control);
                    }

                    if (data.telemetry?.Entries) {
                        const entries = data.telemetry.Entries;
                        for (const driverNum of this.subscribedDrivers) {
                            const car = entries[0]?.Cars?.[driverNum.toString()];
                            if (car && this.callbacks) {
                                const ch = car.Channels;
                                this.callbacks.onTelemetry(driverNum, {
                                    lapX: Date.now(),
                                    rpm: ch['0'] || 0,
                                    speed: ch['2'] || 0,
                                    gear: ch['3'] || 0,
                                    throttle: ch['4'] || 0,
                                    brake: ch['5'] || 0
                                });
                            }
                        }
                    }
                } catch (e) {
                    this.callbacks?.onError?.(e);
                }
            });

            this.ws.on('error', (err) => {
                console.warn(`⚠️ [${this.name}] Connection issue:`, err.message);
                reject(err);
            });
        });
    }

    subscribeDriver(driverNumber: number): void {
        this.subscribedDrivers.add(driverNumber);
    }

    unsubscribeDriver(driverNumber: number): void {
        this.subscribedDrivers.delete(driverNumber);
    }

    disconnect(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.subscribedDrivers.clear();
    }
}