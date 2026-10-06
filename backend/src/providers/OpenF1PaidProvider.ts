import axios from 'axios';
import mqtt, { MqttClient } from 'mqtt';
import { ITelemetryProvider, TelemetryCallbacks } from './ITelemetryProvider';

export class OpenF1PaidProvider implements ITelemetryProvider {
    name = 'OpenF1 Paid (MQTT WebSocket Stream)';
    private username: string;
    private password: string;
    private tokenUrl: string;
    private accessToken: string | null = null;
    private tokenExpiryTime = 0;
    private mqttClient: MqttClient | null = null;
    private subscribedDrivers = new Set<number>();
    private callbacks: TelemetryCallbacks | null = null;
    private refreshTimer: ReturnType<typeof setTimeout> | null = null;

    private readonly liveTopics = [
        'v1/sessions',
        'v1/drivers',
        'v1/championship_drivers',
        'v1/championship_teams',
        'v1/car_data',
        'v1/location',
        'v1/laps',
        'v1/stints',
        'v1/pit',
        'v1/intervals',
        'v1/position',
        'v1/weather',
        'v1/race_control',
        'v1/session_result'
    ];

    constructor(username: string, password: string, _baseUrl: string, tokenUrl: string) {
        this.username = username;
        this.password = password;
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
        const expiresIn = Number.parseInt(response.data.expires_in, 10) || 3600;
        this.tokenExpiryTime = Date.now() + Math.max(60, expiresIn - 300) * 1000;
    }

    private scheduleRefresh() {
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        const delay = Math.max(60_000, this.tokenExpiryTime - Date.now() - 60_000);
        this.refreshTimer = setTimeout(async () => {
            try {
                this.accessToken = null;
                await this.authenticate();
                this.mqttClient?.end(true);
                await this.connect(this.callbacks!);
            } catch (error) {
                this.callbacks?.onError?.(error);
            }
        }, delay);
    }

    async connect(callbacks: TelemetryCallbacks): Promise<void> {
        this.callbacks = callbacks;
        await this.authenticate();

        if (!this.accessToken) throw new Error('Failed to obtain OpenF1 token.');

        if (this.mqttClient) this.mqttClient.end(true);

        this.mqttClient = mqtt.connect('wss://mqtt.openf1.org:8084/mqtt', {
            username: this.username,
            password: this.accessToken,
            protocol: 'wss',
            reconnectPeriod: 5000
        });

        await new Promise<void>((resolve, reject) => {
            const client = this.mqttClient!;
            const onConnect = () => {
                client.removeListener('error', onError);
                resolve();
            };
            const onError = (error: Error) => {
                client.removeListener('connect', onConnect);
                reject(error);
            };
            client.once('connect', onConnect);
            client.once('error', onError);
        });

        this.mqttClient.subscribe(this.liveTopics, error => {
            if (error) this.callbacks?.onError?.(error);
            else console.log(`🔌 [Live Engine] Subscribed to ${this.liveTopics.length} OpenF1 streams.`);
        });

        this.scheduleRefresh();

        this.mqttClient.on('message', (topic, payload) => {
            try {
                const data = JSON.parse(payload.toString());
                const normalizedTopic = topic.replace(/^v1\//, '');
                this.callbacks?.onStreamData?.(normalizedTopic, data);

                if (normalizedTopic === 'car_data' && data.driver_number) {
                    const dNum = Number(data.driver_number);
                    if (this.subscribedDrivers.has(dNum)) {
                        this.callbacks?.onTelemetry?.(dNum, {
                            lapX: Number(data.lapX ?? Date.now()),
                            date: data.date,
                            speed: Number(data.speed || 0),
                            rpm: Number(data.rpm || 0),
                            gear: Number(data.n_gear || 0),
                            throttle: Number(data.throttle || 0),
                            brake: Number(data.brake || 0),
                            drs: Number(data.drs || 0)
                        });
                    }
                }

                if (normalizedTopic === 'race_control') this.callbacks?.onRaceControl?.(data);
                if (normalizedTopic === 'intervals') this.callbacks?.onInterval?.(data);
                if (normalizedTopic === 'position') this.callbacks?.onPosition?.(data);
                if (normalizedTopic === 'weather') this.callbacks?.onWeather?.(data);
            } catch (error) {
                this.callbacks?.onError?.(error);
            }
        });
    }

    subscribeDriver(driverNumber: number) {
        this.subscribedDrivers.add(driverNumber);
    }

    unsubscribeDriver(driverNumber: number) {
        this.subscribedDrivers.delete(driverNumber);
    }

    disconnect() {
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = null;
        this.mqttClient?.end(true);
        this.mqttClient = null;
        this.subscribedDrivers.clear();
        this.accessToken = null;
    }
}
