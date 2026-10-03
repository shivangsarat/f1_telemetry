import dotenv from 'dotenv';
dotenv.config();

export const CONFIG = {
    LIVE_PROVIDER: (process.env.LIVE_PROVIDER || 'FREE') as 'FREE' | 'OPENF1_PAID',
    OPENF1_USERNAME: process.env.OPENF1_USERNAME || '',
    OPENF1_PASSWORD: process.env.OPENF1_PASSWORD || '',
    OPENF1_BASE: 'https://api.openf1.org/v1',
    OPENF1_TOKEN_URL: 'https://api.openf1.org/token',
    ERGAST_BASE: 'https://api.jolpi.ca/ergast/f1',
    FASTF1_WS_URL: 'ws://localhost:8082'
};

// Add these two exports at the bottom:
export const OPENF1_BASE = CONFIG.OPENF1_BASE;
export const ERGAST_BASE = CONFIG.ERGAST_BASE;