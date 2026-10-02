// Toggle this to TRUE during development to route all traffic through your Time Machine
const USE_MOCK_SERVER = true;

export const OPENF1_BASE = USE_MOCK_SERVER 
    ? 'http://localhost:8081' 
    : 'https://api.openf1.org/v1';

export const ERGAST_BASE = USE_MOCK_SERVER
    ? 'http://localhost:8081/ergast'
    : 'https://api.jolpi.ca/ergast/f1';