import axios from 'axios';
import mqtt, { MqttClient } from 'mqtt';
import { ITelemetryProvider, TelemetryCallbacks } from './ITelemetryProvider';

export class OpenF1PaidProvider implements ITelemetryProvider {
    name = 'OpenF1 Paid (MQTT WebSocket Stream)';
    private username: string;
    private password: string;
    private baseUrl: string;
    private tokenUrl: string;

    private accessToken: string | null = null;
    private tokenExpiryTime: number = 0;
    private mqttClient: MqttClient | null = null;
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
        console.log("accessToken", this.accessToken);
        const expiresIn = parseInt(response.data.expires_in, 10) || 3600;
        this.tokenExpiryTime = Date.now() + (expiresIn - 300) * 1000;
    }

    private setupTokenRefreshTimer() {
        // Refresh token 5 minutes before it expires (e.g., every 55 minutes)
        const refreshInterval = (3600 - 300) * 1000; 
        setTimeout(async () => {
            try {
                console.log('🔄 [Live Engine] Refreshing OAuth token for MQTT stream...');
                this.accessToken = null; // Force new token fetch
                await this.authenticate();
                
                // Reconnect MQTT with the fresh token
                if (this.mqttClient) {
                    this.mqttClient.end(true, {}, () => {
                        this.connect(this.callbacks!);
                    });
                }
            } catch (err) {
                console.error('❌ Failed to refresh token for MQTT:', err);
            }
        }, refreshInterval);
    }

    async connect(callbacks: TelemetryCallbacks): Promise<void> {
        this.callbacks = callbacks;
        await this.authenticate();

        if (!this.accessToken) {
            throw new Error('Failed to obtain OpenF1 token for MQTT connection.');
        }

        console.log(`🔌 [Live Engine] Connecting to OpenF1 MQTT WebSocket Broker...`);

        // Connect to OpenF1 MQTT over WSS using the OAuth2 token as the password
        this.mqttClient = mqtt.connect('wss://mqtt.openf1.org:8084/mqtt', {
            username: this.username,
            password: this.accessToken,
            protocol: 'wss',
            reconnectPeriod: 5000
        });

        this.mqttClient.on('connect', () => {
            console.log('🔌 [Live Engine] Connected successfully to OpenF1 MQTT WebSocket Stream.');
            // Subscribe to live topics for car data and race control
            this.mqttClient?.subscribe('v1/car_data');
            this.mqttClient?.subscribe('v1/race_control');

            this.setupTokenRefreshTimer();
        });

        this.mqttClient.on('message', (topic, payload) => {
            try {
                const data = JSON.parse(payload.toString());
                
                if (topic === 'v1/car_data' && data.driver_number) {
                    const dNum = Number(data.driver_number);
                    if (this.subscribedDrivers.has(dNum)) {
                        this.callbacks?.onTelemetry(dNum, {
                            lapX: Date.now(),
                            speed: data.speed || 0,
                            rpm: data.rpm || 0,
                            gear: data.n_gear || 0,
                            throttle: data.throttle || 0,
                            brake: data.brake || 0
                        });
                    }
                }

                if (topic === 'v1/race_control') {
                    this.callbacks?.onRaceControl?.(data);
                }
            } catch (err) {
                console.error('Error parsing MQTT message:', err);
            }
        });

        this.mqttClient.on('error', (err) => {
            this.callbacks?.onError?.(err);
        });
    }

    subscribeDriver(driverNumber: number): void {
        this.subscribedDrivers.add(driverNumber);
    }

    unsubscribeDriver(driverNumber: number): void {
        this.subscribedDrivers.delete(driverNumber);
    }

    disconnect(): void {
        if (this.mqttClient) {
            this.mqttClient.end();
            this.mqttClient = null;
        }
        this.subscribedDrivers.clear();
        this.accessToken = null;
    }
}