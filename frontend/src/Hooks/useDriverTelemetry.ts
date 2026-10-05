import { useEffect } from 'react';
import { useRaceStore } from '../store/useRaceStore';

export const useDriverTelemetry = (driverNumber: number, isLive: boolean) => {
    const payload = useRaceStore(state =>
        state.driverLive[driverNumber] || { telemetry: [], laps: [], stints: [], driver: null }
    );
    const subscribe = useRaceStore(state => state.subscribeToDriver);
    const unsubscribe = useRaceStore(state => state.unsubscribeFromDriver);

    useEffect(() => {
        if (!isLive || !Number.isFinite(driverNumber)) return;
        subscribe(driverNumber);
        return () => unsubscribe(driverNumber);
    }, [driverNumber, isLive, subscribe, unsubscribe]);

    return payload;
};
