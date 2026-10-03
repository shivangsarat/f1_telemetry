export interface DriverTelemetryPoint {
    lapX: number;
    speed: number;
    rpm: number;
    gear: number;
    throttle: number;
    brake: number;
}

export interface TelemetryCallbacks {
    onTelemetry: (driverNumber: number, point: DriverTelemetryPoint) => void;
    onRaceControl?: (message: any) => void;
    onError?: (err: any) => void;
}

export interface ITelemetryProvider {
    name: string;
    connect(callbacks: TelemetryCallbacks): Promise<void>;
    subscribeDriver(driverNumber: number): void;
    unsubscribeDriver(driverNumber: number): void;
    disconnect(): void;
}