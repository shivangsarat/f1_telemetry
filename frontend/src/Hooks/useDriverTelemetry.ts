import { useState, useEffect, useRef } from 'react';

export const useDriverTelemetry = (driverNumber: number, isLive: boolean) => {
    const [payload, setPayload] = useState<{telemetry: any[], laps: any[], stints: any[]}>({ telemetry: [], laps: [], stints: [] });
    const ws = useRef<WebSocket | null>(null);

    useEffect(() => {
        if (!isLive) return;
        ws.current = new WebSocket('ws://localhost:8080');
        ws.current.onopen = () => ws.current?.send(JSON.stringify({ type: 'SUBSCRIBE_TELEMETRY', driver: driverNumber }));
        
        ws.current.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'TELEMETRY_UPDATE' && msg.driver === driverNumber && msg.data) {
                setPayload(msg.data);
            }
        };
        return () => {
            if (ws.current?.readyState === WebSocket.OPEN) ws.current?.send(JSON.stringify({ type: 'UNSUBSCRIBE_TELEMETRY', driver: driverNumber }));
            ws.current?.close();
        };
    }, [driverNumber, isLive]);

    return payload;
};