const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());

const TARGET_SESSION_KEY = 9158; // Baku Race 2024
const PRESENT_TIME = Date.now();
const SIMULATED_RACE_START = PRESENT_TIME - (15 * 60 * 1000); 
const SIMULATED_RACE_END = PRESENT_TIME + (105 * 60 * 1000);

const cache = new Map();
let queue = Promise.resolve();
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const enqueueRequest = (url) => {
    const execute = queue.then(async () => {
        await sleep(200); 
        return axios.get(url);
    });
    queue = execute.catch(() => {});
    return execute;
};

// --- SORT SESSIONS CHRONOLOGICALLY & ANCHOR LIVE TIMELINE ---
function mockSessionTimeline(sessions) {
    if (!Array.isArray(sessions)) return sessions;

    const mapped = sessions.map((s, idx) => {
        const session = { ...s };
        if (String(session.session_key) === String(TARGET_SESSION_KEY)) {
            session.date_start = new Date(SIMULATED_RACE_START).toISOString();
            session.date_end = new Date(SIMULATED_RACE_END).toISOString();
        } else {
            const offsetDays = (idx - 2) * 0.1; 
            const sessionTime = PRESENT_TIME + (offsetDays * 24 * 60 * 60 * 1000);
            session.date_start = new Date(sessionTime).toISOString();
            session.date_end = new Date(sessionTime + (90 * 60 * 1000)).toISOString();
        }
        return session;
    });

    // Guaranteed chronological sort: Practice 1 -> Practice 2 -> Practice 3 -> Qualifying -> Race
    return mapped.sort((a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime());
}

app.use(async (req, res) => {
    try {
        let targetUrl;

        if (req.originalUrl.startsWith('/ergast')) {
            const path = req.originalUrl.replace('/ergast', '').replace('current', '2024/16');
            targetUrl = `https://api.jolpi.ca/ergast/f1${path}`;
            
            if (!cache.has(targetUrl)) {
                const response = await axios.get(targetUrl);
                cache.set(targetUrl, response.data);
            }
            return res.json(cache.get(targetUrl));
        }

        let incomingUrl = req.originalUrl;

        // TRICK THE BACKEND: If the backend asks for the live session info (9158) 
        // or checks live status, we map it or adjust TTL behavior via proxy responses.
        targetUrl = `https://api.openf1.org/v1${incomingUrl}`;
        const currentYear = new Date().getFullYear();
        targetUrl = targetUrl.replace(`year=${currentYear}`, 'year=2024');

        if (!cache.has(targetUrl)) {
            const response = await enqueueRequest(targetUrl);
            cache.set(targetUrl, response.data);
        }

        let data = JSON.parse(JSON.stringify(cache.get(targetUrl)));

        // If the backend asks for live status, trick it into returning our mock live session key
        if (incomingUrl.includes('/sessions?session_key=latest')) {
            if (Array.isArray(data) && data[0]) {
                data[0].session_key = TARGET_SESSION_KEY;
                data[0].date_start = new Date(SIMULATED_RACE_START).toISOString();
                data[0].date_end = new Date(SIMULATED_RACE_END).toISOString();
            }
        }

        if (incomingUrl.includes('/sessions')) {
            data = mockSessionTimeline(data);
        } else if (incomingUrl.includes('/car_data') || incomingUrl.includes('/position')) {
            if (Array.isArray(data) && data.length > 120) {
                data = data.slice(data.length - 120);
            }
        }

        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.json(data);
    } catch (err) {
        console.error("Mock Server Error:", err.message);
        res.status(err.response?.status || 500).json({ error: 'Mock Server Error' });
    }
});

app.listen(8081, () => {
    console.log(`\n🏎️  F1 TIME MACHINE running on http://localhost:8081 (Zero production code pollution)`);
});