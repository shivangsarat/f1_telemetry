import { create } from 'zustand';

interface RaceState {
    intervals: any[];
    weather: any | null;
    sessionBests: any | null;
    isRace: boolean;
    maxRaceLap: number;
    raceControl: any[];
    connect: () => void;
}

export const useRaceStore = create<RaceState>((set) => {
    let ws: WebSocket | null = null;
    return {
        intervals: [], weather: null, sessionBests: null, isRace: true, maxRaceLap: 0, raceControl: [],
        connect: () => {
            if (ws?.readyState === WebSocket.OPEN) return;
            // In production, use the current host. In dev, use localhost:8080.
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = import.meta.env.PROD 
                ? `${wsProtocol}//${window.location.host}` 
                : 'ws://localhost:8080';
                
            ws = new WebSocket(wsUrl);
            ws.onmessage = (event) => {
                const msg = JSON.parse(event.data);
                if (msg.type === 'GLOBAL_TICK' && msg.data) {
                    set({ 
                        intervals: msg.data.results, 
                        weather: msg.data.weather, 
                        sessionBests: msg.data.sessionBests,
                        isRace: msg.data.isRace,
                        maxRaceLap: msg.data.maxRaceLap,
                        raceControl: msg.raceControl || []
                    });
                }
            };
        }
    };
});