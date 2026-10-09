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
    private readonly telemetryListeners = new Set<(payload: any) => void>();
    private readonly carData = new Map<number, any[]>();
    private readonly locationHistory = new Map<number, any[]>();
    private readonly latestLocations = new Map<number, any>();
    private readonly driverPitState = new Map<number, boolean>();
    private readonly driverCheckeredState = new Set<number>();
    private trackReferenceDriver: number | null = null;
    private trackTrace: any[] = [];
    private championshipContext: any = null;
    private trackMeta: any = null;
    private availableSessions: any[] = [];
    private scheduledTotalLaps: number | null = null;
    private readonly timingMemory = new Map<number, {
        bestLapRaw: number;
        bestLap: string;
        bestSectors: any;
        lastLapNumber: number;
        lastLap: string;
        lastSectors: any;
        completedLaps: number;
    }>();
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
        this.availableSessions = calculated.availableSessions || this.availableSessions;

        // A newly-started live session can begin emitting laps/weather before the
        // MQTT drivers topic is replayed. Seed the live engine with driver metadata
        // from the REST-calculated results so those incoming lap rows immediately
        // produce a classification instead of collapsing to an empty table.
        if (Array.isArray(calculated.results) && calculated.results.length > 0) {
            const driverMap = this.maps.get('drivers')!;
            for (const result of calculated.results) {
                const bootstrapDriverNumber = Number(result.driver_number);
                if (Number.isFinite(bootstrapDriverNumber) && bootstrapDriverNumber > 0) {
                    this.rememberDriverTiming(result);
                }
                const driverNumber = Number(result.driver_number);
                if (!Number.isFinite(driverNumber) || driverNumber <= 0) continue;

                const driverInfo = {
                    driver_number: driverNumber,
                    full_name: result.name,
                    name_acronym: result.name_acronym,
                    team_name: result.team_name,
                    team_colour: result.team_color || result.team_colour
                };

                driverMap.set(keyFor('drivers', driverInfo), driverInfo);
            }
            this.syncCollection('drivers');
        }

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

    subscribeTelemetry(listener: (payload: any) => void) {
        this.telemetryListeners.add(listener);
        return () => this.telemetryListeners.delete(listener);
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
                this.updateDriverCheckeredState(row);
                continue;
            }

            if (topic === 'intervals') {
                const map = this.maps.get(topic)!;
                const key = keyFor(topic, row);
                const previous = map.get(key) || {};

                const hasFiniteInterval =
                    row.interval !== null
                    && row.interval !== undefined
                    && row.interval !== ''
                    && Number.isFinite(Number(row.interval));
                const incomingGap = row.gap_to_leader ?? row.gap;
                const hasFiniteGap =
                    incomingGap !== null
                    && incomingGap !== undefined
                    && incomingGap !== ''
                    && Number.isFinite(Number(incomingGap));

                const merged = {
                    ...previous,
                    ...row,
                    interval: hasFiniteInterval ? row.interval : previous.interval,
                    gap_to_leader: hasFiniteGap
                        ? incomingGap
                        : (previous.gap_to_leader ?? previous.gap),
                    _interval_authoritative_date: hasFiniteInterval
                        ? row.date
                        : previous._interval_authoritative_date,
                    _gap_authoritative_date: hasFiniteGap
                        ? row.date
                        : previous._gap_authoritative_date
                };

                map.set(key, merged);
                this.syncCollection(topic);
                continue;
            }

            if (topic === 'pit') {
                const map = this.maps.get(topic)!;
                map.set(keyFor(topic, row), row);
                this.syncCollection(topic);

                const driverNumber = Number(row.driver_number);
                if (Number.isFinite(driverNumber)) {
                    const previous = this.driverPitState.get(driverNumber) || false;
                    this.driverPitState.set(driverNumber, true);
                    if (!previous) this.scheduleEmit();
                }
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
        this.driverPitState.clear();
        this.driverCheckeredState.clear();
        this.trackReferenceDriver = null;
        this.trackTrace = [];
        this.championshipContext = null;
        this.trackMeta = null;
        this.availableSessions = [];
        this.scheduledTotalLaps = null;
        this.timingMemory.clear();
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

        this.updatePitStateFromTelemetry(dNum, row);
        if (emit) this.emitLatestTelemetry(dNum);
    }

    private updateDriverCheckeredState(row: any) {
        const message = String(row?.message || row?.text || '');
        const explicitDriver = Number(row?.driver_number);
        const carMatch = message.match(/\bCAR\s+(\d+)\b/i);
        const driverNumber = Number.isFinite(explicitDriver) && explicitDriver > 0
            ? explicitDriver
            : Number(carMatch?.[1]);

        if (!Number.isFinite(driverNumber) || driverNumber <= 0) return;

        const flag = String(row?.flag || '').toUpperCase();
        const hasCheckered =
            flag === 'CHEQUERED'
            || flag === 'CHECKERED'
            || /\bCHEQUERED\b/i.test(message)
            || /\bCHECKERED\b/i.test(message);

        if (hasCheckered) {
            this.driverCheckeredState.add(driverNumber);
            this.scheduleEmit();
        }
    }

    private updatePitStateFromTelemetry(dNum: number, telemetryRow: any) {
        if (!this.driverPitState.get(dNum)) return;

        const driverPits = this.state.pits
            .filter((pit: any) => Number(pit.driver_number) === dNum)
            .sort((a: any, b: any) =>
                new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime()
            );
        const latestPit = driverPits[driverPits.length - 1];
        if (!latestPit?.date || !telemetryRow?.date) return;

        const pitStart = new Date(latestPit.date).getTime();
        const telemetryTime = new Date(telemetryRow.date).getTime();
        if (!Number.isFinite(pitStart) || !Number.isFinite(telemetryTime) || telemetryTime < pitStart) return;

        const elapsedMs = telemetryTime - pitStart;
        const laneDurationSeconds = Number(
            latestPit.lane_duration
            ?? latestPit.pit_duration
            ?? latestPit.duration
        );
        const speed = Number(telemetryRow.speed);

        const durationSaysExited =
            Number.isFinite(laneDurationSeconds)
            && laneDurationSeconds > 0
            && elapsedMs > (laneDurationSeconds * 1000) + 1500;

        // Fallback for early live pit records whose lane duration has not been
        // populated yet. Once the car is clearly back above pit-lane speed, the
        // transient PIT state can be removed.
        const telemetrySaysExited =
            elapsedMs > 5000
            && Number.isFinite(speed)
            && speed > 120;

        const stalePitState = elapsedMs > 90000;

        if (durationSaysExited || telemetrySaysExited || stalePitState) {
            this.driverPitState.set(dNum, false);
            this.scheduleEmit();
        }
    }

    private emitLatestTelemetry(dNum: number) {
        const driverListeners = this.driverListeners.get(dNum);
        if (!driverListeners?.size && this.telemetryListeners.size === 0) return;

        const history = this.carData.get(dNum) || [];
        const locations = this.locationHistory.get(dNum) || [];
        const telemetry = buildTelemetryHistory(history.slice(-12), this.state.laps, locations.slice(-24));
        const point = telemetry[telemetry.length - 1];
        if (!point) return;

        const pointTime = point?.date ? new Date(point.date).getTime() : NaN;
        const payload = {
            type: 'LIVE_TELEMETRY_POINT',
            sessionKey: this.activeSessionKey,
            timestamp: Number.isFinite(pointTime) ? pointTime : Date.now(),
            driver: dNum,
            data: point
        };

        for (const listener of this.telemetryListeners) listener(payload);
        for (const listener of driverListeners || []) listener(payload);
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

    private getTrackerSnapshot(results: any[] = [], cutoffMs?: number) {
        const resultByDriver = new Map(results.map(driver => [Number(driver.driver_number), driver]));
        const driverInfoByNumber = new Map(this.state.drivers.map(driver => [Number(driver.driver_number), driver]));
        const cutoff = Number(cutoffMs);
        const hasCutoff = Number.isFinite(cutoff);

        const locationEntries: Array<[number, any]> = [];
        if (hasCutoff) {
            for (const [driverNumber, history] of this.locationHistory.entries()) {
                let location: any = null;
                for (const row of history) {
                    const time = row?.date ? new Date(row.date).getTime() : NaN;
                    if (!Number.isFinite(time) || time > cutoff) continue;
                    if (!location || new Date(location.date || 0).getTime() <= time) location = row;
                }
                if (location) locationEntries.push([driverNumber, location]);
            }
        } else {
            for (const [driverNumber, location] of this.latestLocations.entries()) {
                locationEntries.push([driverNumber, location]);
            }
        }

        const cars = locationEntries.map(([driverNumber, location]) => {
            const result = resultByDriver.get(driverNumber) || {};
            const info = driverInfoByNumber.get(driverNumber) || {};
            const resolvedName =
                result.name
                || info.full_name
                || info.broadcast_name
                || info.name_acronym
                || `Driver ${driverNumber}`;

            return {
                driver_number: driverNumber,
                x: Number(location.x),
                y: Number(location.y),
                z: Number(location.z || 0),
                date: location.date,
                position: Number.isFinite(Number(result.position)) ? Number(result.position) : null,
                name: resolvedName,
                acronym: result.name_acronym || info.name_acronym || null,
                team_name: result.team_name || info.team_name || null,
                team_color: result.team_color || info.team_colour || info.team_color || 'ffffff'
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

        const trace = hasCutoff
            ? this.trackTrace.filter((point: any) => {
                const time = point?.date ? new Date(point.date).getTime() : NaN;
                return Number.isFinite(time) && time <= cutoff;
            })
            : this.trackTrace;

        return {
            trace,
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

    getTrackerSnapshotAt(cutoffMs?: number) {
        const race = this.getSnapshot().data;
        return this.getTrackerSnapshot(race?.results || [], cutoffMs);
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

    private rememberDriverTiming(result: any) {
        const driverNumber = Number(result?.driver_number);
        if (!Number.isFinite(driverNumber) || driverNumber <= 0) return result;

        const previous = this.timingMemory.get(driverNumber);
        const incomingBestRaw = Number(result?.best_lap_raw);
        const previousBestRaw = Number(previous?.bestLapRaw);

        const hasIncomingBest = Number.isFinite(incomingBestRaw) && incomingBestRaw > 0;
        const shouldUpdateBest = hasIncomingBest
            && (!Number.isFinite(previousBestRaw) || incomingBestRaw < previousBestRaw);

        const incomingLastNumber = Number(result?.last_completed_lap_number || result?.completed_laps || 0);
        const previousLastNumber = Number(previous?.lastLapNumber || 0);
        const hasIncomingLast = incomingLastNumber > 0 && result?.last_lap && result.last_lap !== '-';
        const shouldUpdateLast = hasIncomingLast && incomingLastNumber >= previousLastNumber;

        const incomingCompletedLaps = Number(result?.completed_laps ?? result?.driver_laps ?? 0);
        const previousCompletedLaps = Number(previous?.completedLaps || 0);

        const nextMemory = {
            bestLapRaw: shouldUpdateBest
                ? incomingBestRaw
                : (Number.isFinite(previousBestRaw) ? previousBestRaw : incomingBestRaw),
            bestLap: shouldUpdateBest
                ? result.best_lap
                : (previous?.bestLap || result.best_lap || '-'),
            bestSectors: shouldUpdateBest
                ? result.best_sectors
                : (previous?.bestSectors || result.best_sectors || null),
            lastLapNumber: shouldUpdateLast ? incomingLastNumber : previousLastNumber,
            lastLap: shouldUpdateLast
                ? result.last_lap
                : (previous?.lastLap || result.last_lap || '-'),
            lastSectors: shouldUpdateLast
                ? result.last_sectors
                : (previous?.lastSectors || result.last_sectors || null),
            completedLaps: Math.max(
                Number.isFinite(incomingCompletedLaps) ? incomingCompletedLaps : 0,
                previousCompletedLaps
            )
        };

        this.timingMemory.set(driverNumber, nextMemory);

        return {
            ...result,
            best_lap_raw: Number.isFinite(nextMemory.bestLapRaw) ? nextMemory.bestLapRaw : result.best_lap_raw,
            best_lap: nextMemory.bestLap || result.best_lap,
            best_sectors: nextMemory.bestSectors || result.best_sectors,
            last_completed_lap_number: Math.max(incomingLastNumber, nextMemory.lastLapNumber || 0),
            last_lap: nextMemory.lastLap || result.last_lap,
            last_sectors: nextMemory.lastSectors || result.last_sectors,
            completed_laps: Math.max(Number(result?.completed_laps || 0), nextMemory.completedLaps || 0),
            driver_laps: Math.max(Number(result?.driver_laps || 0), nextMemory.completedLaps || 0)
        };
    }

    private applyTimingMemory(calculated: any) {
        if (!Array.isArray(calculated?.results)) return calculated;

        const rememberedResults = calculated.results.map((result: any) => this.rememberDriverTiming(result));

        if (calculated.isRace) {
            return {
                ...calculated,
                results: rememberedResults
            };
        }

        // Practice/Qualifying/Sprint Qualifying timing towers are ranked by each
        // driver's best valid lap. Timing memory is applied after the raw pure
        // calculation, so we must re-rank after restoring a driver's persisted PB;
        // otherwise a restored 1:33 can remain below a stale 1:35 position.
        const ranked = [...rememberedResults]
            .sort((a: any, b: any) => {
                const aBest = Number(a.best_lap_raw);
                const bBest = Number(b.best_lap_raw);
                const aValid = Number.isFinite(aBest) && aBest > 0;
                const bValid = Number.isFinite(bBest) && bBest > 0;

                if (aValid && bValid) return aBest - bBest;
                if (aValid) return -1;
                if (bValid) return 1;
                return Number(a.position || 999) - Number(b.position || 999);
            })
            .map((result: any) => ({ ...result }));

        const timedResults = ranked.filter((result: any) => {
            const best = Number(result.best_lap_raw);
            return Number.isFinite(best) && best > 0;
        });
        const leaderBest = Number(timedResults[0]?.best_lap_raw);

        // Rebuild the entire non-race tower atomically from the same set of
        // persisted PBs. Never carry an interval/gap forward from the previous
        // snapshot: one new PB can change the leader gap for every timed driver
        // and can change neighbour intervals wherever the ordering moves.
        ranked.forEach((result: any, index: number) => {
            result.position = index + 1;
            result.interval_estimated = false;
            result.gap_estimated = false;
            result.interval_source = 'best_lap_classification';
            result.gap_source = 'best_lap_classification';

            const currentBest = Number(result.best_lap_raw);
            if (!Number.isFinite(currentBest) || currentBest <= 0 || !Number.isFinite(leaderBest)) {
                result.interval = '-';
                result.gap_to_leader = 'No Time';
                return;
            }

            if (index === 0) {
                result.interval = 'Leader';
                result.gap_to_leader = 'Leader';
                return;
            }

            const previousBest = Number(ranked[index - 1]?.best_lap_raw);
            result.gap_to_leader = `+${Math.max(0, currentBest - leaderBest).toFixed(3)}s`;
            result.interval = Number.isFinite(previousBest) && previousBest > 0
                ? `+${Math.max(0, currentBest - previousBest).toFixed(3)}s`
                : '-';
        });

        const leaderResult = ranked.find((result: any) => {
            const best = Number(result.best_lap_raw);
            return Number.isFinite(best) && best > 0;
        });

        const sessionBests = {
            ...(calculated.sessionBests || {}),
            lap: leaderResult
                ? {
                    time: leaderResult.best_lap,
                    raw: Number(leaderResult.best_lap_raw),
                    driver: leaderResult.name_acronym
                        || leaderResult.acronym
                        || leaderResult.name
                        || String(leaderResult.driver_number)
                }
                : calculated.sessionBests?.lap
        };

        return {
            ...calculated,
            sessionBests,
            results: ranked
        };
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
        const hasStreamState = this.state.drivers.length > 0;
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

        const calculatedRaw = calculateRaceView({
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
            availableSessions: this.availableSessions,
            sessionFinished: this.state.raceControl.some(message => String(message.flag || '').toUpperCase() === 'CHEQUERED')
        });
        const calculatedWithTiming = this.applyTimingMemory(calculatedRaw);
        const calculated = {
            ...calculatedWithTiming,
            results: Array.isArray(calculatedWithTiming?.results)
                ? calculatedWithTiming.results.map((result: any) => {
                    const driverNumber = Number(result.driver_number);
                    const latestPit = Array.isArray(result.pit_stops) && result.pit_stops.length > 0
                        ? result.pit_stops[result.pit_stops.length - 1]
                        : null;
                    const rawLatestPit = this.state.pits
                        .filter((pit: any) => Number(pit.driver_number) === driverNumber)
                        .sort((a: any, b: any) =>
                            new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime()
                        )
                        .at(-1);

                    return {
                        ...result,
                        in_pit: Boolean(this.driverPitState.get(driverNumber)),
                        checkered: this.driverCheckeredState.has(driverNumber),
                        active_pit: this.driverPitState.get(driverNumber)
                            ? {
                                lap: Number(rawLatestPit?.lap_number ?? latestPit?.lap ?? result.current_lap ?? 0) || null,
                                date: rawLatestPit?.date || null,
                                stop_duration: rawLatestPit?.stop_duration ?? latestPit?.stop_duration ?? null,
                                lane_duration: rawLatestPit?.lane_duration ?? latestPit?.lane_duration ?? null,
                                pit_duration: rawLatestPit?.pit_duration ?? latestPit?.pit_duration ?? null
                            }
                            : null
                    };
                })
                : calculatedWithTiming?.results
        };

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
        return this.getDriverSnapshotAt(driverNumber, includeTelemetry);
    }

    getDriverSnapshotAt(driverNumber: number, includeTelemetry = true, cutoffMs?: number) {
        const race = this.getSnapshot().data;
        const driver = race.results?.find((d: any) => Number(d.driver_number) === driverNumber) || null;
        const cutoff = Number(cutoffMs);
        const hasCutoff = Number.isFinite(cutoff);

        const laps = this.state.laps.filter(lap => {
            if (Number(lap.driver_number) !== driverNumber) return false;
            if (!hasCutoff) return true;
            const start = lap?.date_start ? new Date(lap.date_start).getTime() : NaN;
            return !Number.isFinite(start) || start <= cutoff;
        });

        const carData = (this.carData.get(driverNumber) || []).filter(row => {
            if (!hasCutoff) return true;
            const time = row?.date ? new Date(row.date).getTime() : NaN;
            return Number.isFinite(time) && time <= cutoff;
        });

        const locations = (this.locationHistory.get(driverNumber) || []).filter(row => {
            if (!hasCutoff) return true;
            const time = row?.date ? new Date(row.date).getTime() : NaN;
            return Number.isFinite(time) && time <= cutoff;
        });

        const telemetry = includeTelemetry
            ? buildTelemetryHistory(carData, laps, locations)
            : undefined;

        const latestLapX = includeTelemetry && telemetry?.length
            ? Number(telemetry[telemetry.length - 1]?.lapX)
            : NaN;
        const latestLap = Number.isFinite(latestLapX)
            ? Math.max(1, Math.floor(latestLapX))
            : Math.max(0, ...laps.map(lap => Number(lap.lap_number || 0)));

        const stints = this.state.stints.filter(stint =>
            Number(stint.driver_number) === driverNumber
            && (!hasCutoff || latestLap <= 0 || Number(stint.lap_start || 0) <= latestLap)
        );

        return {
            type: 'LIVE_DRIVER_STATE',
            sessionKey: this.activeSessionKey,
            driver: driverNumber,
            timestamp: hasCutoff ? cutoff : Date.now(),
            data: {
                driver,
                ...(includeTelemetry ? { telemetry } : {}),
                laps,
                stints
            }
        };
    }
}
