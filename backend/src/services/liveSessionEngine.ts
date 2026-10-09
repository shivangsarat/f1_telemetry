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
    private trackerScheduled = false;
    private readonly listeners = new Set<(snapshot: any) => void>();
    private readonly driverListeners = new Map<number, Set<(payload: any) => void>>();
    private readonly carData = new Map<number, any[]>();
    private readonly locationHistory = new Map<number, any[]>();
    private readonly latestLocations = new Map<number, any>();
    private trackReferenceDriver: number | null = null;
    private trackTrace: any[] = [];
    private championshipContext: any = null;
    private trackMeta: any = null;
    private scheduledTotalLaps: number | null = null;
    private readonly maps = new Map<string, Map<string, any>>();

    hydrate(calculated: any, sessionKey?: string | number | null) {
        if (!calculated || typeof calculated !== 'object') return;

        const nextKey = sessionKey != null ? String(sessionKey) : null;
        if (nextKey && this.activeSessionKey && nextKey !== this.activeSessionKey) {
            this.reset();
        }
        if (nextKey) this.activeSessionKey = nextKey;

        this.state.sessionInfo = calculated.sessionInfo || this.state.sessionInfo;
        this.state.weather = calculated.weather ?? this.state.weather;
        this.state.raceControl = calculated.raceControl || this.state.raceControl;
        this.state.championshipDrivers = calculated.championshipDrivers || this.state.championshipDrivers;
        this.state.championshipTeams = calculated.championshipTeams || this.state.championshipTeams;
        this.championshipContext = calculated.championshipMeta || this.championshipContext;
        const hydratedScheduledLaps = Number(calculated.scheduledTotalLaps);
        if (Number.isFinite(hydratedScheduledLaps) && hydratedScheduledLaps > 0) {
            this.scheduledTotalLaps = hydratedScheduledLaps;
        }
        this.trackMeta = {
            meetingInfo: calculated.meetingInfo || null,
            circuitInfo: calculated.circuitInfo || null
        };

        // The REST bootstrap is already calculated by the same pure layer. Preserve
        // it until the MQTT collections have enough raw state to replace it.
        this.bootstrapSnapshot = calculated;
    }

    private bootstrapSnapshot: any | null = null;

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
        const batchedCarDrivers = new Set<number>();

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
                const driverNumber = Number(row.driver_number);
                this.ingestCarData(row, !Array.isArray(data));
                if (Array.isArray(data) && Number.isFinite(driverNumber)) batchedCarDrivers.add(driverNumber);
                continue;
            }

            if (topic === 'location') {
                this.ingestLocation(row);
                continue;
            }

            if (topic === 'lap_count') {
                const total = Number(row.TotalLaps ?? row.totalLaps ?? row.total_laps);
                if (Number.isFinite(total) && total > 0) this.scheduledTotalLaps = total;
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

        if (topic === 'car_data' && Array.isArray(data)) {
            for (const driverNumber of batchedCarDrivers) this.emitLatestTelemetry(driverNumber);
        }

        if (topic === 'location') this.scheduleTrackerEmit();
        else if (topic !== 'car_data') this.scheduleEmit();
    }

    private handleSession(session: any) {
        const nextKey = session.session_key != null ? String(session.session_key) : null;

        // MQTT can deliver a stale/retained session announcement after REST has
        // already moved us onto the current session. Never let an older session
        // switch the engine backwards.
        if (nextKey && this.activeSessionKey && nextKey !== this.activeSessionKey) {
            const currentStart = new Date(this.state.sessionInfo?.date_start || 0).getTime();
            const incomingStart = new Date(session?.date_start || 0).getTime();

            if (
                Number.isFinite(currentStart)
                && currentStart > 0
                && Number.isFinite(incomingStart)
                && incomingStart > 0
                && incomingStart < currentStart
            ) {
                return;
            }

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
        this.locationHistory.clear();
        this.latestLocations.clear();
        this.trackReferenceDriver = null;
        this.trackTrace = [];
        this.championshipContext = null;
        this.trackMeta = null;
        this.scheduledTotalLaps = null;
        this.bootstrapSnapshot = null;
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
        const message = String(row?.message || row?.text || '');
        const revisedLapMatch =
            message.match(/RACE\s+WILL\s+BE\s+(\d{1,3})\s+LAPS?/i)
            || message.match(/RACE\s+DISTANCE[^0-9]*(\d{1,3})\s+LAPS?/i)
            || message.match(/TOTAL\s+LAPS?[^0-9]*(\d{1,3})/i);
        if (revisedLapMatch) {
            const total = Number(revisedLapMatch[1]);
            if (Number.isFinite(total) && total > 0) this.scheduledTotalLaps = total;
        }

        const key = keyFor('race_control', row);
        const without = this.state.raceControl.filter(x => keyFor('race_control', x) !== key);
        this.state.raceControl = [row, ...without]
            .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
            .slice(0, 300);
    }

    private ingestCarData(row: any, emit = true) {
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

        if (emit) this.emitLatestTelemetry(dNum);
    }

    private emitLatestTelemetry(dNum: number) {
        const listeners = this.driverListeners.get(dNum);
        if (!listeners?.size) return;

        const history = this.carData.get(dNum) || [];
        const locations = this.locationHistory.get(dNum) || [];
        const telemetry = buildTelemetryHistory(history.slice(-12), this.state.laps, locations.slice(-24));
        const point = telemetry[telemetry.length - 1];
        if (!point) return;

        for (const listener of listeners) listener({
            type: 'LIVE_TELEMETRY_POINT',
            driver: dNum,
            data: point
        });
    }

    private ingestLocation(row: any) {
        const dNum = Number(row.driver_number);
        if (!Number.isFinite(dNum)) return;

        const history = this.locationHistory.get(dNum) || [];
        const key = row._key || row._id || row.date;
        const index = history.findIndex(x => (x._key || x._id || x.date) === key);
        if (index >= 0) history[index] = row;
        else history.push(row);
        history.sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());
        if (history.length > 4000) history.splice(0, history.length - 4000);
        this.locationHistory.set(dNum, history);
        this.latestLocations.set(dNum, row);

        if (this.trackReferenceDriver === null) this.trackReferenceDriver = dNum;
        if (dNum === this.trackReferenceDriver) {
            const point = { x: Number(row.x), y: Number(row.y), z: Number(row.z || 0), date: row.date };
            const last = this.trackTrace[this.trackTrace.length - 1];
            if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 5) {
                this.trackTrace.push(point);
                if (this.trackTrace.length > 1600) {
                    this.trackTrace.splice(0, this.trackTrace.length - 1600);
                }
            }
        }
    }

    private getTrackerSnapshot(results: any[] = []) {
        const resultByDriver = new Map(results.map(driver => [Number(driver.driver_number), driver]));
        const driverInfoByNumber = new Map(this.state.drivers.map(driver => [Number(driver.driver_number), driver]));

        const cars = [...this.latestLocations.entries()].map(([driverNumber, location]) => {
            const result = resultByDriver.get(driverNumber) || {};
            const info = driverInfoByNumber.get(driverNumber) || {};
            return {
                driver_number: driverNumber,
                x: Number(location.x),
                y: Number(location.y),
                z: Number(location.z || 0),
                date: location.date,
                position: result.position ?? null,
                name: result.name || info.full_name || info.name_acronym || String(driverNumber),
                acronym: info.name_acronym || null,
                team_color: result.team_color || info.team_colour || 'ffffff'
            };
        });

        const rawCorners = this.trackMeta?.circuitInfo?.corners || [];
        const corners = rawCorners
            .map((corner: any) => ({
                number: corner.number ?? corner.Number ?? null,
                letter: corner.letter ?? corner.Letter ?? '',
                x: Number(corner.trackPosition?.x ?? corner.x ?? corner.X),
                y: Number(corner.trackPosition?.y ?? corner.y ?? corner.Y)
            }))
            .filter((corner: any) => Number.isFinite(corner.x) && Number.isFinite(corner.y));

        return {
            trace: this.trackTrace,
            cars,
            referenceDriver: this.trackReferenceDriver,
            circuit: {
                name: this.trackMeta?.meetingInfo?.circuit_short_name || this.state.sessionInfo?.circuit_short_name || null,
                image: this.trackMeta?.meetingInfo?.circuit_image || null,
                rotation: Number(this.trackMeta?.circuitInfo?.rotation || 0),
                corners
            }
        };
    }

    setScheduledTotalLaps(totalLaps: number | null | undefined) {
        const total = Number(totalLaps);
        if (!Number.isFinite(total) || total <= 0) return;
        if (this.scheduledTotalLaps === total) return;
        this.scheduledTotalLaps = total;
        this.scheduleEmit();
    }

    private scheduleTrackerEmit() {
        if (this.trackerScheduled) return;
        this.trackerScheduled = true;
        setTimeout(() => {
            this.trackerScheduled = false;
            const snapshot = this.getSnapshot();
            for (const listener of this.listeners) listener(snapshot);
        }, 250);
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
        const hasStreamState = this.state.drivers.length > 0 || this.state.laps.length > 0 || this.state.positions.length > 0;
        if (!hasStreamState && this.bootstrapSnapshot) {
            return {
                type: 'LIVE_RACE_STATE',
                sessionKey: this.activeSessionKey,
                timestamp: Date.now(),
                data: {
                    ...this.bootstrapSnapshot,
                    tracker: this.getTrackerSnapshot(this.bootstrapSnapshot.results || [])
                }
            };
        }

        const calculated = calculateRaceView({
            sessionInfo: this.state.sessionInfo,
            meetingInfo: this.trackMeta?.meetingInfo,
            circuitInfo: this.trackMeta?.circuitInfo,
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
            sessionResults: this.state.sessionResults,
            remainingChampionshipPoints: this.championshipContext?.remainingChampionshipPoints,
            scheduledTotalLaps: this.scheduledTotalLaps,
            sessionFinished: this.state.raceControl.some(message => String(message.flag || '').toUpperCase() === 'CHEQUERED')
        });

        return {
            type: 'LIVE_RACE_STATE',
            sessionKey: this.activeSessionKey,
            timestamp: Date.now(),
            data: {
                ...calculated,
                tracker: this.getTrackerSnapshot(calculated.results || [])
            }
        };
    }

    getDriverSnapshot(driverNumber: number, includeTelemetry = true) {
        const race = this.getSnapshot().data;
        const driver = race.results?.find((d: any) => Number(d.driver_number) === driverNumber) || null;
        const telemetry = includeTelemetry
            ? buildTelemetryHistory(
                this.carData.get(driverNumber) || [],
                this.state.laps,
                this.locationHistory.get(driverNumber) || []
            )
            : undefined;

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
