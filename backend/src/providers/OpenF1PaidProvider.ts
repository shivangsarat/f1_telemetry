import axios from 'axios';
import { ITelemetryProvider, TelemetryCallbacks } from './ITelemetryProvider';

export class OpenF1PaidProvider implements ITelemetryProvider {
    name = 'OpenF1 Paid (Batched REST)';
    private username: string;
    private password: string;
    private baseUrl: string;
    private tokenUrl: string;

    private accessToken: string | null = null;
    private tokenExpiryTime: number = 0;
    private lastFetchTime: string = new Date(Date.now() - 2000).toISOString();

    private pollInterval: NodeJS.Timeout | null = null;
    private subscribedDrivers = new Set<number>();
    private callbacks: TelemetryCallbacks | null = null;

    constructor(username: string, password: string, baseUrl: string, tokenUrl: string) {
        this.username = username;
        this.password = password;
        this.baseUrl = baseUrl;
        this.tokenUrl = tokenUrl;
    }

    private async authenticate() {
        if (this.accessToken && Date.now() < this.tokenExpiryTime) return; 

        const params = new URLSearchParams();
        params.append('username', this.username);
        params.append('password', this.password);

        const response = await axios.post(this.tokenUrl, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        
        this.accessToken = response.data.access_token;
        const expiresIn = parseInt(response.data.expires_in, 10) || 3600;
        this.tokenExpiryTime = Date.now() + (expiresIn - 300) * 1000;
    }

    private get authHeaders() {
        return { 'Authorization': `Bearer ${this.accessToken}`, 'User-Agent': 'F1-Dash-Multiplexer/1.0' };
    }

    async connect(callbacks: TelemetryCallbacks): Promise<void> {
        this.callbacks = callbacks;
        await this.authenticate();
        console.log(`🔌 [Live Engine] Connected via ${this.name}. Optimized for 30 req/min.`);

        // POLL EVERY 2 SECONDS (30 requests per minute total)
        this.pollInterval = setInterval(async () => {
            if (this.subscribedDrivers.size === 0) return;

            try {
                await this.authenticate();

                // Fetch telemetry for ALL drivers in ONE request
                const carRes = await axios.get(`${this.baseUrl}/car_data?session_key=latest&date>=${this.lastFetchTime}`, { 
                    headers: this.authHeaders 
                });

                if (carRes.data && carRes.data.length > 0) {
                    // Update timestamp for the next tick to prevent fetching duplicate data
                    this.lastFetchTime = carRes.data[carRes.data.length - 1].date;

                    // Group payload by driver
                    const driverData = new Map<number, any[]>();
                    carRes.data.forEach((point: any) => {
                        const dNum = point.driver_number;
                        if (!driverData.has(dNum)) driverData.set(dNum, []);
                        driverData.get(dNum)!.push(point);
                    });

                    // Broadcast only to drivers the frontend is actively watching
                    for (const [driverNum, points] of driverData.entries()) {
                        if (this.subscribedDrivers.has(driverNum) && points.length > 0) {
                            const latest = points[points.length - 1]; 
                            this.callbacks?.onTelemetry(driverNum, {
                                lapX: Date.now(), 
                                speed: latest.speed || 0,
                                rpm: latest.rpm || 0,
                                gear: latest.n_gear || 0,
                                throttle: latest.throttle || 0,
                                brake: latest.brake || 0
                            });
                        }
                    }
                }
            } catch (err: any) {
                this.callbacks?.onError?.(err);
            }
        }, 200);
    }

    subscribeDriver(driverNumber: number): void { this.subscribedDrivers.add(driverNumber); }
    unsubscribeDriver(driverNumber: number): void { this.subscribedDrivers.delete(driverNumber); }
    disconnect(): void {
        if (this.pollInterval) clearInterval(this.pollInterval);
        this.subscribedDrivers.clear();
        this.accessToken = null;
    }
}