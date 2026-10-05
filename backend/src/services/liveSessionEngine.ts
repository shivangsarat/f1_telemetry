import { buildTelemetryHistory, calculateRaceView } from '../calculations/raceCalculations';

type LiveState = {
    sessionInfo: any;
    drivers: any[];
    intervals: any[];
    positions: any[];
    laps: any[];
    stints: any[];
    pits: any[];
    weather: any;
    raceControl: any[];
    championshipDrivers: any[];
    championshipTeams: any[];
    sessionResults: any[];
};

const COLLECTION_TOPICS = new Set(['drivers', 'intervals', 'position', 'laps', 'stints', 'pit', 'championship_drivers', 'championship_teams', 'session_result', 'race_control']);

const keyFor = (topic: string, row: any) => {
    if (row?._key) return `${topic}:${row._key}`;
    if (topic === 'laps') return `laps:${row.driver_number}:${row.lap_number}`;
    if (topic === 'stints') return `stints:${row.driver_number}:${row.stint_number ?? row.lap_start}`;
    if (topic === 'pit') return `pit:${row.driver_number}:${row.lap_number ?? row.lap_number}`;
    if (topic === 'intervals') return `intervals:${row.driver_number}`;
    if (topic === 'position') return `position:${row.driver_number}`;
    if (topic === 'drivers') return `drivers:${row.driver_number}`;
    if (topic === 'championship_drivers') return `championship_drivers:${row.driver_number}`;
    if (topic === 'championship_teams') return `championship_teams:${row.team_name}`;
    if (topic === 'session_result') return `session_result:${row.driver_number}`;
    return JSON.stringify(row);
};

export class LiveSessionEngine {
    private state: LiveState = {
        sessionInfo: {},
        drivers: [],
        intervals: [],
        positions: [],
        laps: [],
        stints: [],
        pits: [],
        weather: null,
        raceControl: [],
        championshipDrivers: [],
        championshipTeams: [],
        sessionResults: []
    };

    private activeSessionKey: string | null = null;
    private scheduled = false;
    private readonly listeners = new Set<(snapshot: any) => void>();
    private readonly driverListeners = new Map<number, Set<(payload: any) => void>>();
    private readonly carData = new Map<number, any[]>();
    private readonly maps = new Map<string, Map<string, any>>();

    constructor() {
        ['drivers', 'intervals', 'position', 'laps', 'stints', 'pit', 'championship_drivers', 'championship_teams', 'session_result'].forEach(topic => {
            this.maps.set(topic, new Map());
        });
    }

    subscribe(listener: (snapshot: any) => void) {
        this.listeners.add(listener);
        listener(this.getSnapshot());
        return () => this.listeners.delete(listener);
    }

    subscribeDriver(driverNumber: number, listener: (payload: any) => void) {
        if (!this.driverListeners.has(driverNumber)) this.driverListeners.set(driverNumber, new Set());
        this.driverListeners.get(driverNumber)!.add(listener);
        listener(this.getDriverSnapshot(driverNumber));
        return () => {
            const listeners = this.driverListeners.get(driverNumber);
            listeners?.delete(listener);
            if (listeners?.size === 0) this.driverListeners.delete(driverNumber);
        };
    }

    ingest(topic: string, data: any) {
        const rows = Array.isArray(data) ? data : [data];

        for (const row of rows) {
            if (!row || typeof row !== 'object') continue;

            const rowSession = row.session_key != null ? String(row.session_key) : null;
            if (topic !== 'sessions' && rowSession && this.activeSessionKey && rowSession !== this.activeSessionKey) continue;

            if (topic === 'sessions') {
                this.handleSession(row);
                continue;
            }

            if (rowSession && !this.activeSessionKey) {
                this.activeSessionKey = rowSession;
            }

            if (topic === 'car_data') {
                this.ingestCarData(row);
                continue;
            }

            if (topic === 'weather') {
                this.state.weather = row;
                continue;
            }

            if (topic === 'race_control') {
                this.upsertRaceControl(row);
                continue;
            }

            if (COLLECTION_TOPICS.has(topic)) {
                const map = this.maps.get(topic)!;
                map.set(keyFor(topic, row), row);
                this.syncCollection(topic);
            }
        }

        if (topic !== 'car_data') this.scheduleEmit();
    }

    private handleSession(session: any) {
        const nextKey = session.session_key != null ? String(session.session_key) : null;
        if (nextKey && this.activeSessionKey && nextKey !== this.activeSessionKey) {
            this.reset();
        }
        if (nextKey) this.activeSessionKey = nextKey;
        this.state.sessionInfo = { ...this.state.sessionInfo, ...session };
    }

    private reset() {
        this.state = {
            sessionInfo: {},
            drivers: [],
            intervals: [],
            positions: [],
            laps: [],
            stints: [],
            pits: [],
            weather: null,
            raceControl: [],
            championshipDrivers: [],
            championshipTeams: [],
            sessionResults: []
        };
        this.maps.forEach(map => map.clear());
        this.carData.clear();
    }

    private syncCollection(topic: string) {
        const values = [...(this.maps.get(topic)?.values() || [])];
        switch (topic) {
            case 'drivers': this.state.drivers = values; break;
            case 'intervals': this.state.intervals = values; break;
            case 'position': this.state.positions = values; break;
            case 'laps': this.state.laps = values.sort((a, b) => Number(a.lap_number || 0) - Number(b.lap_number || 0)); break;
            case 'stints': this.state.stints = values; break;
            case 'pit': this.state.pits = values; break;
            case 'championship_drivers': this.state.championshipDrivers = values; break;
            case 'championship_teams': this.state.championshipTeams = values; break;
            case 'session_result': this.state.sessionResults = values; break;
        }
    }

    private upsertRaceControl(row: any) {
        const key = keyFor('race_control', row);
        const without = this.state.raceControl.filter(x => keyFor('race_control', x) !== key);
        this.state.raceControl = [row, ...without]
            .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
            .slice(0, 300);
    }

    private ingestCarData(row: any) {
        const dNum = Number(row.driver_number);
        if (!Number.isFinite(dNum)) return;
        const history = this.carData.get(dNum) || [];
        const key = row._key || row._id || row.date;
        const index = history.findIndex(x => (x._key || x._id || x.date) === key);
        if (index >= 0) history[index] = row;
        else history.push(row);
        history.sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());

        // Keep enough current-session history to make the driver charts useful
        // without retaining an unbounded stream forever.
        if (history.length > 30_000) history.splice(0, history.length - 30_000);
        this.carData.set(dNum, history);

        const listeners = this.driverListeners.get(dNum);
        if (listeners?.size) {
            const telemetry = buildTelemetryHistory([row], this.state.laps);
            const point = telemetry[telemetry.length - 1];
            if (point) {
                for (const listener of listeners) listener({
                    type: 'LIVE_TELEMETRY_POINT',
                    driver: dNum,
                    data: point
                });
            }
        }
    }

    private scheduleEmit() {
        if (this.scheduled) return;
        this.scheduled = true;
        setTimeout(() => {
            this.scheduled = false;
            const snapshot = this.getSnapshot();
            for (const listener of this.listeners) listener(snapshot);
            for (const [driver, listeners] of this.driverListeners) {
                const payload = this.getDriverSnapshot(driver, false);
                for (const listener of listeners) listener(payload);
            }
        }, 50);
    }

    getSnapshot() {
        const calculated = calculateRaceView({
            sessionInfo: this.state.sessionInfo,
            drivers: this.state.drivers,
            intervals: this.state.intervals,
            positions: this.state.positions,
            laps: this.state.laps,
            stints: this.state.stints,
            pits: this.state.pits,
            weather: this.state.weather,
            raceControl: this.state.raceControl,
            championshipDrivers: this.state.championshipDrivers,
            championshipTeams: this.state.championshipTeams,
            sessionResults: this.state.sessionResults
        });

        return {
            type: 'LIVE_RACE_STATE',
            sessionKey: this.activeSessionKey,
            timestamp: Date.now(),
            data: calculated
        };
    }

    getDriverSnapshot(driverNumber: number, includeTelemetry = true) {
        const race = this.getSnapshot().data;
        const driver = race.results?.find((d: any) => Number(d.driver_number) === driverNumber) || null;
        const telemetry = includeTelemetry ? buildTelemetryHistory(this.carData.get(driverNumber) || [], this.state.laps) : undefined;

        return {
            type: 'LIVE_DRIVER_STATE',
            sessionKey: this.activeSessionKey,
            driver: driverNumber,
            timestamp: Date.now(),
            data: {
                driver,
                ...(includeTelemetry ? { telemetry } : {}),
                laps: this.state.laps.filter(l => Number(l.driver_number) === driverNumber),
                stints: this.state.stints.filter(s => Number(s.driver_number) === driverNumber)
            }
        };
    }
}
