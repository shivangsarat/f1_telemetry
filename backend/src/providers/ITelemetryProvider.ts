export interface DriverTelemetryPoint {
    lapX: number;
    speed: number;
    rpm: number;
    gear: number;
    throttle: number;
    brake: number;
    drs?: number;
    date?: string;
    preLap?: boolean;
}

export interface TelemetryCallbacks {
    onTelemetry: (driverNumber: number, point: DriverTelemetryPoint) => void;
    onStreamData?: (topic: string, data: any) => void;
    onRaceControl?: (message: any) => void;
    onInterval?: (message: any) => void;
    onPosition?: (message: any) => void;
    onWeather?: (message: any) => void;
    onError?: (err: any) => void;
}

export interface ITelemetryProvider {
    name: string;
    connect(callbacks: TelemetryCallbacks): Promise<void>;
    subscribeDriver(driverNumber: number): void;
    unsubscribeDriver(driverNumber: number): void;
    disconnect(): void;
}
