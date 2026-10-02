import { create } from 'zustand';
import type { SessionBests } from '../types';

interface RaceState {
    intervals: any[];
    weather: any | null;
    socket: WebSocket | null;
    sessionBests: SessionBests | null;
    connect: () => void;
}

export const useRaceStore = create<RaceState>((set, get) => ({
    intervals: [],
    weather: null,
    socket: null,
    sessionBests: null,
    connect: () => {
        if (get().socket) return;
        const ws = new WebSocket('ws://localhost:8080');
        
        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'GLOBAL_TICK') {
                set({ intervals: msg.data.intervals, weather: msg.data.weather });
            }
        };
        set({ socket: ws });
    }
}));