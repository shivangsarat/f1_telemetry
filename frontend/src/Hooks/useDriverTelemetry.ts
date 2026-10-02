import { useEffect, useRef, useState } from 'react';
import { useRaceStore } from '../store/useRaceStore';

export const useDriverTelemetry = (driverNumber: number, isLive: boolean = true) => {
    const [telemetry, setTelemetry] = useState<any[]>([]);
    const ws = useRaceStore(state => state.socket);
    const lastTimestampRef = useRef<string | null>(null);

    useEffect(() => {
        if (!isLive || !ws || ws.readyState !== WebSocket.OPEN) return;

        ws.send(JSON.stringify({ type: 'SUBSCRIBE_TELEMETRY', driver: driverNumber }));

        const handleMessage = (event: MessageEvent) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'TELEMETRY_UPDATE' && msg.driver === driverNumber) {
                const newData = msg.data;
                if (newData.length > 0) {
                    lastTimestampRef.current = newData[newData.length - 1].date;
                    setTelemetry(prev => [...prev, ...newData].slice(-500));
                }
            }
        };

        ws.addEventListener('message', handleMessage);

        const handleVisibilityChange = () => {
            if (document.hidden) {
                ws.send(JSON.stringify({ type: 'UNSUBSCRIBE_TELEMETRY', driver: driverNumber }));
            } else {
                ws.send(JSON.stringify({ 
                    type: 'SUBSCRIBE_TELEMETRY', driver: driverNumber, since: lastTimestampRef.current 
                }));
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            ws.removeEventListener('message', handleMessage);
            ws.send(JSON.stringify({ type: 'UNSUBSCRIBE_TELEMETRY', driver: driverNumber }));
        };
    }, [driverNumber, ws, isLive]);

    return telemetry;
};