import { useEffect } from 'react';
import { useRaceStore } from '../store/useRaceStore';

const EMPTY_DRIVER_DATA = {
    driver: null,
    telemetry: [] as any[],
    laps: [] as any[],
    stints: [] as any[]
};

export const useDriverTelemetry = (driverNumber: number, isLive: boolean) => {
    const payload = useRaceStore(state => state.driverLive[driverNumber] || EMPTY_DRIVER_DATA);
    const subscribe = useRaceStore(state => state.subscribeToDriver);
    const unsubscribe = useRaceStore(state => state.unsubscribeFromDriver);

    useEffect(() => {
        if (!isLive || !Number.isFinite(driverNumber)) return;
        subscribe(driverNumber);
        return () => unsubscribe(driverNumber);
    }, [driverNumber, isLive, subscribe, unsubscribe]);

    return payload;
};
