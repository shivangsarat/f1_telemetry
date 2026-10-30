import { useEffect, useMemo } from 'react';
import { useRaceStore } from '../store/useRaceStore';

const EMPTY_DRIVER_DATA = {
    driver: null,
    telemetry: [] as any[],
    laps: [] as any[],
    stints: [] as any[]
};

const WAITING_TELEMETRY = [{
    lapX: 0,
    speed: 0,
    rpm: 0,
    throttle: 0,
    brake: 0,
    gear: 0,
    drs: 0,
    longitudinalG: 0,
    lateralG: 0,
    totalG: 0,
    awaiting: true
}];

export const useDriverTelemetry = (driverNumber: number, isLive: boolean) => {
    const payload = useRaceStore(state => state.driverLive[driverNumber] || EMPTY_DRIVER_DATA);
    const subscribe = useRaceStore(state => state.subscribeToDriver);
    const unsubscribe = useRaceStore(state => state.unsubscribeFromDriver);

    useEffect(() => {
        if (!isLive || !Number.isFinite(driverNumber)) return;
        subscribe(driverNumber);
        return () => unsubscribe(driverNumber);
    }, [driverNumber, isLive, subscribe, unsubscribe]);

    return useMemo(() => {
        if (!isLive || payload.telemetry.length > 0) return payload;
        return {
            ...payload,
            telemetry: WAITING_TELEMETRY
        };
    }, [isLive, payload]);
};
