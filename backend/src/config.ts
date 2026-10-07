import dotenv from 'dotenv';
dotenv.config();

const mockEnabled = String(process.env.USE_MOCK_OPENF1 || 'false').toLowerCase() === 'true';
const mockPort = Number(process.env.MOCK_OPENF1_PORT || 8091);

export const CONFIG = {
    LIVE_PROVIDER: (process.env.LIVE_PROVIDER || 'FREE') as 'FREE' | 'OPENF1_PAID',
    USE_MOCK_OPENF1: mockEnabled,
    MOCK_OPENF1_PORT: mockPort,
    MOCK_OPENF1_SPEED: Math.max(0.1, Number(process.env.MOCK_OPENF1_SPEED || 20)),
    MOCK_OPENF1_TICK_MS: Math.max(50, Number(process.env.MOCK_OPENF1_TICK_MS || 250)),
    MOCK_OPENF1_LOOP: String(process.env.MOCK_OPENF1_LOOP || 'true').toLowerCase() !== 'false',
    MOCK_OPENF1_LOOP_DELAY_MS: Math.max(0, Number(process.env.MOCK_OPENF1_LOOP_DELAY_MS || 5000)),
    MOCK_OPENF1_SESSION_KEY: process.env.MOCK_OPENF1_SESSION_KEY || '',
    OPENF1_USERNAME: process.env.OPENF1_USERNAME || '',
    OPENF1_PASSWORD: process.env.OPENF1_PASSWORD || '',
    OPENF1_UPSTREAM_BASE: 'https://api.openf1.org/v1',
    OPENF1_UPSTREAM_TOKEN_URL: 'https://api.openf1.org/token',
    OPENF1_BASE: mockEnabled ? `http://localhost:${mockPort}/v1` : 'https://api.openf1.org/v1',
    OPENF1_TOKEN_URL: 'https://api.openf1.org/token',
    ERGAST_BASE: 'https://api.jolpi.ca/ergast/f1',
    FASTF1_WS_URL: 'ws://localhost:8082'
};

export const OPENF1_BASE = CONFIG.OPENF1_BASE;
export const ERGAST_BASE = CONFIG.ERGAST_BASE;
