import axios, { AxiosRequestConfig } from 'axios';
import express from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { CONFIG } from '../config';

type ReplayEvent = {
    at: number;
    topic: string;
    data: any;
};

type Dataset = Record<string, any[]>;

const STREAM_TOPICS = [
    'sessions',
    'drivers',
    'championship_drivers',
    'championship_teams',
    'car_data',
    'location',
    'laps',
    'stints',
    'pit',
    'intervals',
    'position',
    'weather',
    'race_control',
    'session_result'
];

const parseDate = (value: any) => {
    if (!value) return NaN;
    const safe = String(value).replace(/(\.\d{3})\d+/, '$1').replace('+00:00', 'Z');
    return new Date(safe).getTime();
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export class MockOpenF1ReplayServer {
    private app = express();
    private server: http.Server | null = null;
    private wss: WebSocketServer | null = null;
    private interval: ReturnType<typeof setInterval> | null = null;

    private dataset: Dataset = {};
    private meeting: any = null;
    private circuitInfo: any = null;
    private sourceSession: any = null;

    private events: ReplayEvent[] = [];
    private cursor = 0;
    private sourceStart = 0;
    private sourceEnd = 0;
    private loopStartedAt = 0;
    private loopIndex = 0;
    private replayCompleted = false;
    private paused = true;

    private state = new Map<string, any[]>();
    private token: string | null = null;
    private tokenExpiry = 0;

    async start() {
        await this.loadDataset();
        this.configureHttp();

        await new Promise<void>((resolve, reject) => {
            this.server = http.createServer(this.app);
            this.wss = new WebSocketServer({ server: this.server, path: '/stream' });
            this.wss.on('connection', () => {
                if (this.paused) {
                    this.resetReplay();
                    this.paused = false;
                    this.broadcast('sessions', this.state.get('sessions') || []);
                    this.broadcast('drivers', this.state.get('drivers') || []);
                    this.broadcast('championship_drivers', this.state.get('championship_drivers') || []);
                    this.broadcast('championship_teams', this.state.get('championship_teams') || []);
                    console.log('▶️ [Mock OpenF1] Stream client connected; replay started.');
                }
            });
            this.server.once('error', reject);
            this.server.listen(CONFIG.MOCK_OPENF1_PORT, () => resolve());
        });

        this.resetReplay();
        this.paused = true;
        this.interval = setInterval(() => this.tick(), CONFIG.MOCK_OPENF1_TICK_MS);

        console.log(
            `🎬 [Mock OpenF1] Replaying ${this.sourceSession?.session_name || 'Race'} ` +
            `session ${this.sourceSession?.session_key} at ${CONFIG.MOCK_OPENF1_SPEED}x on port ${CONFIG.MOCK_OPENF1_PORT}`
        );
    }

    stop() {
        if (this.interval) clearInterval(this.interval);
        this.interval = null;
        this.wss?.close();
        this.server?.close();
        this.wss = null;
        this.server = null;
    }

    private async getToken() {
        if (!CONFIG.OPENF1_USERNAME || !CONFIG.OPENF1_PASSWORD) return null;
        if (this.token && Date.now() < this.tokenExpiry) return this.token;

        const params = new URLSearchParams();
        params.append('username', CONFIG.OPENF1_USERNAME);
        params.append('password', CONFIG.OPENF1_PASSWORD);

        try {
            const response = await axios.post(CONFIG.OPENF1_UPSTREAM_TOKEN_URL, params, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            this.token = response.data.access_token;
            const expiresIn = Number(response.data.expires_in || 3600);
            this.tokenExpiry = Date.now() + Math.max(60, expiresIn - 300) * 1000;
            return this.token;
        } catch {
            console.warn('⚠️ [Mock OpenF1] Paid token unavailable; falling back to public REST.');
            return null;
        }
    }

    private async upstreamGet(path: string, config: AxiosRequestConfig = {}) {
        const token = await this.getToken();
        const headers = {
            ...(config.headers || {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'User-Agent': 'F1-Dash-Mock-Replay/1.0'
        };

        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                return await axios.get(`${CONFIG.OPENF1_UPSTREAM_BASE}${path}`, {
                    ...config,
                    headers
                });
            } catch (error: any) {
                if (error?.response?.status !== 429 || attempt === 2) throw error;
                await sleep(1000 * (attempt + 1));
            }
        }

        throw new Error(`Failed upstream request ${path}`);
    }

    private async resolveLastRace() {
        if (CONFIG.MOCK_OPENF1_SESSION_KEY) {
            const response = await this.upstreamGet(`/sessions?session_key=${encodeURIComponent(CONFIG.MOCK_OPENF1_SESSION_KEY)}`);
            const session = response.data?.[0];
            if (!session) throw new Error(`Mock session ${CONFIG.MOCK_OPENF1_SESSION_KEY} not found.`);
            return session;
        }

        const now = Date.now();
        const currentYear = new Date().getUTCFullYear();

        for (const year of [currentYear, currentYear - 1]) {
            const response = await this.upstreamGet(`/sessions?year=${year}&session_name=Race`);
            const completed = (response.data || [])
                .filter((session: any) => {
                    const end = parseDate(session.date_end);
                    return Number.isFinite(end) ? end <= now : parseDate(session.date_start) < now;
                })
                .sort((a: any, b: any) => parseDate(b.date_start) - parseDate(a.date_start));

            if (completed.length) return completed[0];
        }

        throw new Error('Could not find a completed race to replay.');
    }

    private async loadDataset() {
        this.sourceSession = await this.resolveLastRace();
        const sessionKey = this.sourceSession.session_key;
        this.sourceStart = parseDate(this.sourceSession.date_start);
        this.sourceEnd = parseDate(this.sourceSession.date_end);

        if (!Number.isFinite(this.sourceStart)) throw new Error('Mock source race has no valid start time.');

        console.log(`📥 [Mock OpenF1] Loading completed race session ${sessionKey} from OpenF1...`);

        this.dataset.sessions = [this.sourceSession];

        for (const topic of STREAM_TOPICS.filter(topic => topic !== 'sessions')) {
            const endpoint = topic;
            try {
                const response = await this.upstreamGet(`/${endpoint}?session_key=${sessionKey}`);
                this.dataset[topic] = Array.isArray(response.data) ? response.data : [];
                console.log(`   ↳ ${topic}: ${this.dataset[topic].length} rows`);
            } catch (error: any) {
                this.dataset[topic] = [];
                console.warn(`⚠️ [Mock OpenF1] Could not load ${topic}; replay will continue without it:`, error?.message || error);
            }
            await sleep(125);
        }

        if (!Number.isFinite(this.sourceEnd)) {
            const datedRows = Object.values(this.dataset)
                .flat()
                .map((row: any) => parseDate(row.date || row.date_end || row.date_start))
                .filter(Number.isFinite);
            this.sourceEnd = datedRows.length ? Math.max(...datedRows) : this.sourceStart + 2 * 60 * 60 * 1000;
        }

        if (this.sourceSession.meeting_key) {
            const meetingResponse = await this.upstreamGet(`/meetings?meeting_key=${this.sourceSession.meeting_key}`);
            this.meeting = meetingResponse.data?.[0] || null;

            if (this.meeting?.circuit_info_url) {
                try {
                    const circuitResponse = await axios.get(this.meeting.circuit_info_url, {
                        headers: { 'User-Agent': 'FastF1/' }
                    });
                    this.circuitInfo = circuitResponse.data;
                } catch (error: any) {
                    console.warn('⚠️ [Mock OpenF1] Circuit metadata unavailable:', error?.message || error);
                }
            }
        }

        this.events = this.buildEvents().sort((a, b) => a.at - b.at);
        console.log(`✅ [Mock OpenF1] Loaded ${this.events.length} replay events.`);
    }

    private lapStart(driverNumber: any, lapNumber: any) {
        const lap = (this.dataset.laps || []).find(
            (row: any) => Number(row.driver_number) === Number(driverNumber)
                && Number(row.lap_number) === Number(lapNumber)
        );
        return parseDate(lap?.date_start);
    }

    private rowEventTime(topic: string, row: any) {
        const direct = parseDate(row.date);
        if (Number.isFinite(direct)) return direct;

        if (topic === 'laps') {
            const start = parseDate(row.date_start);
            if (!Number.isFinite(start)) return this.sourceStart;
            const duration = Number(row.lap_duration || 0);
            return start + Math.max(0, duration) * 1000;
        }

        if (topic === 'stints') {
            const start = this.lapStart(row.driver_number, row.lap_start);
            return Number.isFinite(start) ? start : this.sourceStart;
        }

        if (topic === 'session_result') return this.sourceEnd;

        const start = parseDate(row.date_start);
        return Number.isFinite(start) ? start : this.sourceStart;
    }

    private buildEvents() {
        const events: ReplayEvent[] = [];

        const push = (topic: string, at: number, data: any) => {
            events.push({
                topic,
                at: Math.max(this.sourceStart, Number.isFinite(at) ? at : this.sourceStart),
                data
            });
        };

        for (const row of this.dataset.sessions || []) push('sessions', this.sourceStart, row);
        for (const topic of ['drivers', 'championship_drivers', 'championship_teams']) {
            for (const row of this.dataset[topic] || []) push(topic, this.sourceStart, row);
        }

        for (const row of this.dataset.laps || []) {
            const start = parseDate(row.date_start);
            if (!Number.isFinite(start)) {
                push('laps', this.sourceStart, row);
                continue;
            }

            const s1 = Number(row.duration_sector_1 || 0);
            const s2 = Number(row.duration_sector_2 || 0);
            const lapDuration = Number(row.lap_duration || 0);

            if (s1 > 0) {
                push('laps', start + s1 * 1000, {
                    ...row,
                    lap_duration: null,
                    duration_sector_2: null,
                    duration_sector_3: null,
                    segments_sector_2: [],
                    segments_sector_3: []
                });
            }

            if (s1 > 0 && s2 > 0) {
                push('laps', start + (s1 + s2) * 1000, {
                    ...row,
                    lap_duration: null,
                    duration_sector_3: null,
                    segments_sector_3: []
                });
            }

            push('laps', start + Math.max(lapDuration, s1 + s2) * 1000, row);
        }

        for (const row of this.dataset.stints || []) {
            const start = this.lapStart(row.driver_number, row.lap_start);
            push('stints', Number.isFinite(start) ? start : this.sourceStart, { ...row, lap_end: null });

            const endLap = Number(row.lap_end || 0);
            const endLapRow = (this.dataset.laps || []).find(
                (lap: any) => Number(lap.driver_number) === Number(row.driver_number)
                    && Number(lap.lap_number) === endLap
            );
            const endStart = parseDate(endLapRow?.date_start);
            const endDuration = Number(endLapRow?.lap_duration || 0);
            const endTime = Number.isFinite(endStart) ? endStart + endDuration * 1000 : this.rowEventTime('stints', row);
            push('stints', endTime, row);
        }

        for (const topic of STREAM_TOPICS.filter(topic =>
            !['sessions', 'drivers', 'championship_drivers', 'championship_teams', 'laps', 'stints'].includes(topic)
        )) {
            for (const row of this.dataset[topic] || []) {
                push(topic, this.rowEventTime(topic, row), row);
            }
        }

        return events;
    }

    private syntheticSessionKey() {
        const base = Number(this.sourceSession?.session_key);
        return Number.isFinite(base) ? base + this.loopIndex * 1_000_000 : 9_000_000 + this.loopIndex;
    }

    private transformDate(value: any) {
        const source = parseDate(value);
        if (!Number.isFinite(source)) return value;
        const shifted = source + (this.loopStartedAt - this.sourceStart);
        return new Date(shifted).toISOString();
    }

    private transformRow(row: any, topic: string) {
        const result = { ...clone(row) };
        if ('session_key' in result || topic !== 'meetings') result.session_key = this.syntheticSessionKey();

        for (const field of ['date', 'date_start', 'date_end']) {
            if (result[field]) result[field] = this.transformDate(result[field]);
        }

        if (topic === 'sessions') {
            result.date_start = new Date(this.loopStartedAt).toISOString();
            const acceleratedDuration = (this.sourceEnd - this.sourceStart) / CONFIG.MOCK_OPENF1_SPEED;
            result.date_end = new Date(this.loopStartedAt + acceleratedDuration).toISOString();
            result.session_key = this.syntheticSessionKey();
        }

        return result;
    }

    private stateKey(topic: string, row: any) {
        if (topic === 'laps') return `${row.driver_number}:${row.lap_number}`;
        if (topic === 'stints') return `${row.driver_number}:${row.stint_number ?? row.lap_start}`;
        if (topic === 'drivers') return String(row.driver_number);
        if (topic === 'championship_drivers') return String(row.driver_number);
        if (topic === 'championship_teams') return String(row.team_name);
        if (topic === 'session_result') return String(row.driver_number);
        if (topic === 'sessions') return String(row.session_key);
        return '';
    }

    private applyState(topic: string, row: any) {
        const current = this.state.get(topic) || [];
        const key = this.stateKey(topic, row);

        if (key) {
            const next = current.filter(existing => this.stateKey(topic, existing) !== key);
            next.push(row);
            this.state.set(topic, next);
        } else {
            current.push(row);
            this.state.set(topic, current);
        }
    }

    private resetReplay() {
        this.loopStartedAt = Date.now() + 500;
        this.cursor = 0;
        this.replayCompleted = false;
        this.state.clear();

        for (const topic of ['sessions', 'drivers', 'championship_drivers', 'championship_teams']) {
            for (const row of this.dataset[topic] || []) {
                this.applyState(topic, this.transformRow(row, topic));
            }
        }
    }

    private broadcast(topic: string, rows: any[]) {
        if (!this.wss || rows.length === 0) return;
        const data = rows.length === 1 ? rows[0] : rows;
        const payload = JSON.stringify({ topic: `v1/${topic}`, data });

        for (const client of this.wss.clients) {
            if (client.readyState === WebSocket.OPEN) client.send(payload);
        }
    }

    private tick() {
        if (this.paused || Date.now() < this.loopStartedAt || this.replayCompleted) return;

        const elapsedRealMs = Date.now() - this.loopStartedAt;
        const sourceNow = this.sourceStart + elapsedRealMs * CONFIG.MOCK_OPENF1_SPEED;
        const dueByTopic = new Map<string, any[]>();

        while (this.cursor < this.events.length && this.events[this.cursor].at <= sourceNow) {
            const event = this.events[this.cursor++];
            const transformed = this.transformRow(event.data, event.topic);
            this.applyState(event.topic, transformed);

            if (!dueByTopic.has(event.topic)) dueByTopic.set(event.topic, []);
            dueByTopic.get(event.topic)!.push(transformed);
        }

        for (const [topic, rows] of dueByTopic) this.broadcast(topic, rows);

        if (this.cursor >= this.events.length) {
            this.replayCompleted = true;
            console.log(`🏁 [Mock OpenF1] Replay loop ${this.loopIndex + 1} completed.`);

            if (CONFIG.MOCK_OPENF1_LOOP) {
                setTimeout(() => {
                    this.loopIndex++;
                    this.resetReplay();
                    this.broadcast('sessions', this.state.get('sessions') || []);
                    this.broadcast('drivers', this.state.get('drivers') || []);
                    this.broadcast('championship_drivers', this.state.get('championship_drivers') || []);
                    this.broadcast('championship_teams', this.state.get('championship_teams') || []);
                    console.log(`🔁 [Mock OpenF1] Starting replay loop ${this.loopIndex + 1}.`);
                }, CONFIG.MOCK_OPENF1_LOOP_DELAY_MS);
            }
        }
    }

    private filterRows(rows: any[], query: any) {
        const ignored = new Set(['session_key', 'year', 'session_name']);
        return rows.filter(row => Object.entries(query).every(([key, value]) => {
            if (ignored.has(key) || value === undefined) return true;
            return String(row[key]) === String(value);
        }));
    }

    private configureHttp() {
        this.app.use(express.json());

        this.app.get('/health', (_req, res) => {
            res.json({ ok: true, session_key: this.syntheticSessionKey(), replayCompleted: this.replayCompleted });
        });

        this.app.get('/control/status', (_req, res) => {
            const elapsedRealMs = Math.max(0, Date.now() - this.loopStartedAt);
            const sourceNow = Math.min(this.sourceEnd, this.sourceStart + elapsedRealMs * CONFIG.MOCK_OPENF1_SPEED);
            res.json({
                enabled: true,
                paused: this.paused,
                source_session_key: this.sourceSession?.session_key,
                mock_session_key: this.syntheticSessionKey(),
                source_session_name: this.sourceSession?.session_name,
                speed: CONFIG.MOCK_OPENF1_SPEED,
                loop: CONFIG.MOCK_OPENF1_LOOP,
                event_index: this.cursor,
                event_count: this.events.length,
                source_time: new Date(sourceNow).toISOString()
            });
        });

        this.app.post('/control/restart', (_req, res) => {
            this.loopIndex++;
            this.resetReplay();
            this.paused = false;
            this.broadcast('sessions', this.state.get('sessions') || []);
            this.broadcast('drivers', this.state.get('drivers') || []);
            this.broadcast('championship_drivers', this.state.get('championship_drivers') || []);
            this.broadcast('championship_teams', this.state.get('championship_teams') || []);
            res.json({ ok: true, mock_session_key: this.syntheticSessionKey() });
        });

        this.app.get('/circuit-info', (_req, res) => {
            res.json(this.circuitInfo || {});
        });

        this.app.get('/v1/meetings', (req, res) => {
            if (!this.meeting) return res.json([]);

            const meeting = clone(this.meeting);
            if (meeting.circuit_info_url) {
                meeting.circuit_info_url = `http://localhost:${CONFIG.MOCK_OPENF1_PORT}/circuit-info`;
            }
            res.json(this.filterRows([meeting], req.query));
        });

        for (const topic of STREAM_TOPICS) {
            this.app.get(`/v1/${topic}`, (req, res) => {
                let rows = this.state.get(topic) || [];

                if (topic === 'sessions') {
                    rows = (this.dataset.sessions || []).map(row => this.transformRow(row, 'sessions'));
                }

                res.json(this.filterRows(rows, req.query));
            });
        }
    }
}

let singleton: MockOpenF1ReplayServer | null = null;

export const startMockOpenF1Server = async () => {
    if (singleton) return singleton;
    singleton = new MockOpenF1ReplayServer();
    await singleton.start();
    return singleton;
};
