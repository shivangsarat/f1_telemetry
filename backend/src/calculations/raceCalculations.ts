export type RaceCalculationInput = {
    sessionInfo?: any;
    meetingInfo?: any;
    circuitInfo?: any;
    availableSessions?: any[];
    drivers?: any[];
    intervals?: any[];
    positions?: any[];
    laps?: any[];
    stints?: any[];
    pits?: any[];
    weather?: any;
    raceControl?: any[];
    championshipDrivers?: any[];
    championshipTeams?: any[];
    sessionResults?: any[];
    remainingChampionshipPoints?: number;
    sessionFinished?: boolean;
    scheduledTotalLaps?: number | null;
    isRace?: boolean;
};

const num = (value: any, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

const parseDate = (value: any) => {
    if (!value) return NaN;
    const safe = String(value).replace(/(\.\d{3})\d+/, '$1').replace('+00:00', 'Z');
    return new Date(safe).getTime();
};

type DeletedLapInfo = {
    deleted: true;
    reason: string;
    message: string;
    date?: any;
};

const parseRaceControlLapTime = (message: string) => {
    const match = message.match(/\bTIME\s+((?:\d+:)?\d{1,2}:\d{2}\.\d+|\d+\.\d+)\b/i);
    if (!match) return null;

    const parts = match[1].split(':').map(Number);
    if (parts.some(part => !Number.isFinite(part))) return null;
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
};

const buildDeletedLapIndex = (raceControl: any[] = [], laps: any[] = []) => {
    const deleted = new Map<string, DeletedLapInfo>();
    const deletionByDriverAndTime = new Map<string, string>();

    const orderedMessages = [...raceControl].sort((a, b) => parseDate(a?.date) - parseDate(b?.date));

    for (const event of orderedMessages) {
        const message = String(event?.message || event?.text || '');
        if (!message) continue;

        const driverMatch = message.match(/\bCAR\s+(\d+)\b/i);
        const driverNumber = num(event?.driver_number ?? driverMatch?.[1], -1);
        if (driverNumber <= 0) continue;

        const lapMatch = message.match(/\bLAP\s+(\d+)\b/i);

        // For deletion/reinstatement messages, the LAP value embedded in the FIA
        // message identifies the invalidated lap. OpenF1's structured lap_number
        // can represent the race-control event's current lap instead (often +1),
        // so prefer the explicit message text whenever it is present.
        let lapNumber = num(lapMatch?.[1] ?? event?.lap_number, -1);

        const lapTime = parseRaceControlLapTime(message);
        if (lapNumber <= 0 && lapTime != null) {
            const matchingLap = laps.find((lap: any) =>
                num(lap.driver_number, -1) === driverNumber
                && Math.abs(num(lap.lap_duration, -999) - lapTime) <= 0.005
            );
            if (matchingLap) lapNumber = num(matchingLap.lap_number, -1);
        }

        const timeKey = lapTime != null ? `${driverNumber}:${lapTime.toFixed(3)}` : null;
        const isReinstated = /\bREINSTATED\b/i.test(message);
        const isDeleted = /\bDELETED\b/i.test(message) && !isReinstated;

        if (isReinstated) {
            let key = lapNumber > 0 ? `${driverNumber}:${lapNumber}` : null;
            if (!key && timeKey) key = deletionByDriverAndTime.get(timeKey) || null;
            if (key) {
                deleted.delete(key);
                for (const [storedTimeKey, storedLapKey] of deletionByDriverAndTime) {
                    if (storedLapKey === key) deletionByDriverAndTime.delete(storedTimeKey);
                }
            }
            continue;
        }

        if (!isDeleted || lapNumber <= 0) continue;

        const reasonMatch = message.match(/DELETED\s*-\s*(.*?)(?:\s+LAP\s+\d+\b|\s+\d{1,2}:\d{2}:\d{2}\b|$)/i);
        const reason = reasonMatch?.[1]?.trim() || 'Race control';

        const key = `${driverNumber}:${lapNumber}`;
        deleted.set(key, {
            deleted: true,
            reason,
            message,
            date: event?.date
        });
        if (timeKey) deletionByDriverAndTime.set(timeKey, key);
    }

    return deleted;
};

export const formatGap = (gap: any) => {
    if (gap === null || gap === undefined || gap === '') return '-';
    if (typeof gap === 'string' && gap.toUpperCase().includes('LAP')) return gap;
    const n = Number(gap);
    return Number.isFinite(n) ? `+${n.toFixed(3)}s` : '-';
};

export const formatLapTime = (seconds: number | null | undefined) => {
    if (!seconds || !Number.isFinite(Number(seconds)) || Number(seconds) === Infinity) return '-';
    const n = Number(seconds);
    const m = Math.floor(n / 60);
    const s = (n % 60).toFixed(3);
    return m > 0 ? `${m}:${s.padStart(6, '0')}` : `${s}s`;
};

export const getF1Points = (position: number, isSprint = false) => {
    const pos = Number(position);
    if (!Number.isFinite(pos)) return 0;
    const points = isSprint ? [8, 7, 6, 5, 4, 3, 2, 1] : [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
    return pos >= 1 && pos <= points.length ? points[pos - 1] : 0;
};

export const buildTyreHistory = (rawStints: any[] = [], rawPitStops: any[] = [], lapLimit: number) => {
    const effectiveLapLimit = Math.max(1, num(lapLimit, 1));

    // One physical pit stop should create one tyre boundary. Prefer the most
    // complete record if duplicate stream/API rows exist for the same pit lap.
    const pitByLap = new Map<number, any>();
    for (const raw of rawPitStops || []) {
        const lap = num(raw.lap_number ?? raw.lap, -1);
        if (lap <= 0 || lap >= effectiveLapLimit) continue;

        const normalized = { ...raw, lap };
        const previous = pitByLap.get(lap);
        if (!previous) {
            pitByLap.set(lap, normalized);
            continue;
        }

        const completeness = (p: any) =>
            Number(p.stop_duration != null) +
            Number(p.lane_duration != null) +
            Number(p.pit_duration != null) +
            Number(Boolean(p.date));

        if (completeness(normalized) >= completeness(previous)) {
            pitByLap.set(lap, normalized);
        }
    }

    const pitStops = [...pitByLap.values()].sort((x, y) => x.lap - y.lap);

    // Collapse repeated/updated stint rows. OpenF1 streaming can publish the same
    // stint more than once as lap_end changes; the latest/most complete row wins.
    const stintByIdentity = new Map<string, any>();
    for (const raw of rawStints || []) {
        const start = num(raw.lap_start, -1);
        if (start <= 0) continue;

        const identity = raw.stint_number != null
            ? `stint:${raw.stint_number}`
            : `start:${start}:${String(raw.compound || 'UNKNOWN')}`;

        const previous = stintByIdentity.get(identity);
        if (!previous) {
            stintByIdentity.set(identity, raw);
            continue;
        }

        const previousEnd = num(previous.lap_end, 0);
        const nextEnd = num(raw.lap_end, 0);
        if (nextEnd >= previousEnd || parseDate(raw.date) >= parseDate(previous.date)) {
            stintByIdentity.set(identity, raw);
        }
    }

    const sourceStints = [...stintByIdentity.values()]
        .sort((x, y) => num(x.lap_start) - num(y.lap_start));

    // With pit history available, pit laps are the authoritative tyre-change
    // boundaries: a stop on lap N means the following stint starts on N+1.
    // This prevents stray/overlapping stint rows from producing fake L2/L3
    // boundaries while the actual pit history says L9/L33/L43.
    const boundaries = pitStops.length > 0
        ? [1, ...pitStops.map(p => p.lap + 1).filter(lap => lap > 1 && lap <= effectiveLapLimit), effectiveLapLimit + 1]
        : [
            Math.max(1, sourceStints.length ? num(sourceStints[0].lap_start, 1) : 1),
            ...sourceStints.slice(1).map(stint => num(stint.lap_start)).filter(lap => lap > 1 && lap <= effectiveLapLimit),
            effectiveLapLimit + 1
        ];

    const uniqueBoundaries = [...new Set(boundaries)]
        .filter(lap => lap >= 1 && lap <= effectiveLapLimit + 1)
        .sort((x, y) => x - y);

    const chooseSourceStint = (start: number, end: number) => {
        const exact = sourceStints.find(stint => num(stint.lap_start) === start);
        if (exact) return exact;

        const covering = [...sourceStints]
            .filter(stint => {
                const stintStart = num(stint.lap_start);
                const stintEnd = num(stint.lap_end, effectiveLapLimit);
                return stintStart <= start && (!stintEnd || stintEnd >= start);
            })
            .sort((x, y) => num(y.lap_start) - num(x.lap_start))[0];
        if (covering) return covering;

        const nearestBefore = [...sourceStints]
            .filter(stint => num(stint.lap_start) <= start)
            .sort((x, y) => num(y.lap_start) - num(x.lap_start))[0];
        if (nearestBefore) return nearestBefore;

        return sourceStints.find(stint => num(stint.lap_start) <= end) || null;
    };

    const stints: any[] = [];
    for (let i = 0; i < uniqueBoundaries.length - 1; i++) {
        const start = uniqueBoundaries[i];
        const end = Math.min(effectiveLapLimit, uniqueBoundaries[i + 1] - 1);
        if (end < start) continue;

        const source = chooseSourceStint(start, end);
        const sourceStart = source ? num(source.lap_start, start) : start;
        const exactNewStint = source && sourceStart === start;

        stints.push({
            compound: source?.compound || 'UNKNOWN',
            start,
            end,
            length: end - start + 1,
            tyre_age_at_start: source
                ? num(source.tyre_age_at_start) + (exactNewStint ? 0 : Math.max(0, start - sourceStart))
                : 0,
            has_pit_before: i > 0 && pitStops.some(p => p.lap + 1 === start),
            source_stint_number: source?.stint_number ?? null
        });
    }

    const matchedPitStops = pitStops.map(pit => {
        const nextStint = stints.find(stint => stint.start === pit.lap + 1);
        return {
            ...pit,
            next_stint: nextStint ? {
                compound: nextStint.compound,
                start: nextStint.start,
                end: nextStint.end,
                length: nextStint.length
            } : null
        };
    });

    // Keep both names temporarily so existing UI/data consumers continue to work.
    return {
        stints,
        pitStops: matchedPitStops,
        pit_stops: matchedPitStops
    };
};

const latestByDriver = (rows: any[] = []) => rows.reduce((acc: Record<string, any>, row) => {
    const d = String(row.driver_number);
    const old = acc[d];
    if (!old || parseDate(row.date) >= parseDate(old.date)) acc[d] = row;
    return acc;
}, {});

const earliestByDriver = (rows: any[] = []) => rows.reduce((acc: Record<string, any>, row) => {
    const d = String(row.driver_number);
    const old = acc[d];
    if (!old || parseDate(row.date) < parseDate(old.date)) acc[d] = row;
    return acc;
}, {});

const latestFiniteByDriver = (rows: any[] = [], fields: string[]) => {
    const sorted = [...rows].sort((a, b) => parseDate(b.date) - parseDate(a.date));
    const result: Record<string, any> = {};
    for (const row of sorted) {
        const d = String(row.driver_number);
        if (result[d]) continue;
        const found = fields.find(field => row[field] !== null && row[field] !== undefined && row[field] !== '' && Number.isFinite(Number(row[field])));
        if (found) result[d] = row[found];
    }
    return result;
};

const calculatePartialLapProgress = (lap: any) => {
    if (!lap || num(lap.lap_duration) > 0) return 0;
    const s1 = num(lap.duration_sector_1);
    const s2 = num(lap.duration_sector_2);
    const s3 = num(lap.duration_sector_3);
    const completed = [s1, s2, s3].filter(Boolean).length;
    if (completed === 3) return 0.99;
    if (completed === 2) return 0.66;
    if (completed === 1) return 0.33;
    return 0.05;
};

const WORLD_CHAMPION_SEASONS: Record<string, number[]> = {
    'lewis hamilton': [2008, 2014, 2015, 2017, 2018, 2019, 2020],
    'fernando alonso': [2005, 2006],
    'max verstappen': [2021, 2022, 2023, 2024],
    'lando norris': [2025]
};

const normalizeDriverName = (name: any) => String(name || '')
    .toLowerCase()
    .replace(/[^a-z\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const getChampionStatus = (name: any, sessionYear: number, clinched = false) => {
    const titleSeasons = WORLD_CHAMPION_SEASONS[normalizeDriverName(name)] || [];
    const priorTitleSeasons = titleSeasons.filter(year => year < sessionYear);
    return {
        titles: priorTitleSeasons.length,
        years: priorTitleSeasons,
        defending: titleSeasons.includes(sessionYear - 1),
        clinched
    };
};

const calculateProjectedChampionship = (drivers: any[], championship: any[], isSprint: boolean) => {
    const byDriver = new Map((championship || []).map(x => [String(x.driver_number), x]));
    const projected = drivers.map(d => {
        const c = byDriver.get(String(d.driver_number)) || {};
        const pointsStart = num(c.points_start, 0);
        const positionStart = num(c.position_start, 99);
        const position = num(d.position, 99);
        const finished = d.status === 'Finished' || d.status === 'Classified';
        const addition = getF1Points(position, isSprint);
        const pointsAfter = finished && c.points_current !== undefined ? num(c.points_current, pointsStart + addition) : pointsStart + addition;
        return { driver_number: d.driver_number, pointsStart, posStart: positionStart, pointsAfter, pointsAddition: addition, isFinished: finished };
    }).sort((a, b) => b.pointsAfter - a.pointsAfter || a.posStart - b.posStart);

    const result: Record<string, any> = {};
    projected.forEach((x, index) => {
        const projectedPos = index + 1;
        result[String(x.driver_number)] = {
            ...x,
            projectedPos,
            posChange: x.posStart === 99 ? 0 : x.posStart - projectedPos
        };
    });
    return result;
};

export const buildTelemetryHistory = (carData: any[] = [], laps: any[] = [], locations: any[] = []) => {
    const orderedLaps = [...laps].sort((a, b) => num(a.lap_number) - num(b.lap_number));
    if (!orderedLaps.length) return [];

    const completed = orderedLaps.filter(l => num(l.lap_duration) > 0 && l.date_start);
    const lastCompletedDuration = completed.length ? num(completed[completed.length - 1].lap_duration, 90) : 90;

    const orderedCarData = [...carData]
        .filter(t => t.date)
        .sort((a, b) => parseDate(a.date) - parseDate(b.date));
    const orderedLocations = [...locations]
        .filter(location => location.date && Number.isFinite(Number(location.x)) && Number.isFinite(Number(location.y)))
        .sort((a, b) => parseDate(a.date) - parseDate(b.date));

    const locationDynamics: Array<{ time: number; headingRate: number }> = [];
    const normalizeAngle = (angle: number) => {
        let value = angle;
        while (value > Math.PI) value -= 2 * Math.PI;
        while (value < -Math.PI) value += 2 * Math.PI;
        return value;
    };

    let previousHeading: number | null = null;
    let previousHeadingTime: number | null = null;
    for (let i = 1; i < orderedLocations.length; i++) {
        const previous = orderedLocations[i - 1];
        const current = orderedLocations[i];
        const dx = num(current.x) - num(previous.x);
        const dy = num(current.y) - num(previous.y);
        if (Math.hypot(dx, dy) < 1) continue;

        const heading = Math.atan2(dy, dx);
        const currentTime = parseDate(current.date);
        if (previousHeading !== null && previousHeadingTime !== null) {
            const dt = (currentTime - previousHeadingTime) / 1000;
            if (dt >= 0.05 && dt <= 2) {
                locationDynamics.push({
                    time: currentTime,
                    headingRate: normalizeAngle(heading - previousHeading) / dt
                });
            }
        }
        previousHeading = heading;
        previousHeadingTime = currentTime;
    }

    let dynamicsIndex = 0;
    let previousTelemetry: any = null;
    let smoothedLongitudinalG = 0;
    let smoothedLateralG = 0;

    const points = orderedCarData
        .map(t => {
            const time = parseDate(t.date);
            let lap = completed.find(l => {
                const start = parseDate(l.date_start);
                return time >= start && time <= start + num(l.lap_duration) * 1000;
            });

            let lapX: number;
            if (lap) {
                const start = parseDate(lap.date_start);
                lapX = num(lap.lap_number) + Math.max(0, Math.min(0.999, (time - start) / (num(lap.lap_duration) * 1000)));
            } else {
                const candidates = orderedLaps.filter(l => parseDate(l.date_start) <= time);
                const current = candidates[candidates.length - 1];
                if (!current) return null;
                const start = parseDate(current.date_start);
                const estimate = num(current.lap_duration, lastCompletedDuration) || lastCompletedDuration;
                lapX = num(current.lap_number) + Math.max(0, Math.min(0.999, (time - start) / (estimate * 1000)));
            }

            const speed = num(t.speed);
            let longitudinalG = smoothedLongitudinalG;

            if (previousTelemetry) {
                const dtSeconds = (time - previousTelemetry.time) / 1000;
                if (dtSeconds >= 0.02 && dtSeconds <= 2) {
                    const dvMetersPerSecond = (speed - previousTelemetry.speed) / 3.6;
                    const rawG = (dvMetersPerSecond / dtSeconds) / 9.80665;
                    const boundedG = Math.max(-8, Math.min(8, rawG));
                    smoothedLongitudinalG = (0.35 * boundedG) + (0.65 * smoothedLongitudinalG);
                    longitudinalG = smoothedLongitudinalG;
                }
            }

            while (
                dynamicsIndex < locationDynamics.length - 1
                && Math.abs(locationDynamics[dynamicsIndex + 1].time - time) <= Math.abs(locationDynamics[dynamicsIndex].time - time)
            ) {
                dynamicsIndex++;
            }

            let lateralG = smoothedLateralG;
            const nearest = locationDynamics[dynamicsIndex];
            if (nearest && Math.abs(nearest.time - time) <= 1500) {
                const rawLateralG = ((speed / 3.6) * nearest.headingRate) / 9.80665;
                const boundedLateralG = Math.max(-8, Math.min(8, rawLateralG));
                smoothedLateralG = (0.25 * boundedLateralG) + (0.75 * smoothedLateralG);
                lateralG = smoothedLateralG;
            }

            previousTelemetry = { time, speed };
            const totalG = Math.sqrt((longitudinalG ** 2) + (lateralG ** 2));

            return {
                lapX,
                date: t.date,
                speed,
                throttle: num(t.throttle),
                brake: num(t.brake),
                rpm: num(t.rpm),
                gear: num(t.n_gear),
                drs: t.drs ?? 0,
                longitudinalG: Number(longitudinalG.toFixed(2)),
                lateralG: Number(lateralG.toFixed(2)),
                totalG: Number(totalG.toFixed(2))
            };
        })
        .filter(Boolean) as any[];

    const result: any[] = [];
    let lastX = -1;
    for (const point of points.sort((x, y) => x.lapX - y.lapX)) {
        if (point.lapX > lastX) {
            result.push(point);
            lastX = point.lapX;
        }
    }
    return result;
};

export const calculateRaceView = (input: RaceCalculationInput) => {
    const drivers = Array.isArray(input.drivers) ? input.drivers : [];
    const intervals = Array.isArray(input.intervals) ? input.intervals : [];
    const positions = Array.isArray(input.positions) ? input.positions : [];
    const laps = Array.isArray(input.laps) ? input.laps : [];
    const stints = Array.isArray(input.stints) ? input.stints : [];
    const pits = Array.isArray(input.pits) ? input.pits : [];
    const championshipDrivers = Array.isArray(input.championshipDrivers) ? input.championshipDrivers : [];
    const sessionResults = Array.isArray(input.sessionResults) ? input.sessionResults : [];
    const sessionInfo = input.sessionInfo || {};
    const isRace = input.isRace ?? (
        String(sessionInfo.session_type || sessionInfo.session_name || '').toLowerCase().includes('race')
        || String(sessionInfo.session_type || '').toLowerCase().includes('sprint')
        || intervals.length > 0
        || championshipDrivers.length > 0
    );

    const latestPositions = latestByDriver(positions);
    const initialPositions = earliestByDriver(positions);
    const latestIntervals = latestByDriver(intervals);
    const latestIntervalValues = latestFiniteByDriver(intervals, ['interval']);
    const latestGapValues = latestFiniteByDriver(intervals, ['gap_to_leader', 'gap']);

    const maxRaceLap = Math.max(
        1,
        ...laps.map(l => num(l.lap_number)),
        ...stints.map(s => num(s.lap_end || s.lap_start))
    );

    const driverInfoByNumber = new Map(drivers.map(d => [String(d.driver_number), d]));
    const sessionResultDriverNumbers = new Set(sessionResults.map(row => num(row.driver_number, -1)).filter(n => n > 0));
    const driverNumbers = new Set<number>();

    // Timing feeds can contain transient/auxiliary driver numbers which have no
    // driver metadata (for example the spurious #22 seen after this race).
    // Only promote a number into the classification when it is known by the
    // session's driver list or official session result. This keeps genuine
    // retired/DNS drivers while excluding orphan timing records.
    [drivers, intervals, positions, laps, stints, pits, championshipDrivers, sessionResults].forEach(rows => rows.forEach(row => {
        const d = num(row.driver_number, -1);
        if (d <= 0) return;
        if (driverInfoByNumber.has(String(d)) || sessionResultDriverNumbers.has(d)) driverNumbers.add(d);
    }));

    const sessionResultByDriver = new Map(sessionResults.map(row => [String(row.driver_number), row]));
    const driverRows = [...driverNumbers].map(d => {
        const info = driverInfoByNumber.get(String(d)) || {};
        const interval = latestIntervals[String(d)] || {};
        const result = sessionResultByDriver.get(String(d)) || {};
        const position = num(latestPositions[String(d)]?.position, num(result.position, num(initialPositions[String(d)]?.position, 99)));

        // Do not let a newer null interval/gap sample erase the last valid value.
        // OpenF1 can legitimately emit nulls during pit/position transitions.
        const intervalValue = latestIntervalValues[String(d)] ?? interval.interval ?? result.interval;
        const gapValue = latestGapValues[String(d)] ?? interval.gap_to_leader ?? interval.gap ?? result.gap_to_leader ?? result.gap;

        return {
            ...info,
            ...interval,
            ...result,
            driver_number: d,
            position,
            interval: intervalValue,
            gap_to_leader: gapValue
        };
    });

    // If OpenF1 has a valid gap-to-leader but no interval for a car, reconstruct
    // the interval from the adjacent car's gap. This prevents '-' for otherwise
    // valid midfield cars when a single interval sample is null.
    const orderedByPosition = [...driverRows]
        .filter(d => Number.isFinite(Number(d.position)) && Number(d.position) < 99)
        .sort((a, b) => Number(a.position) - Number(b.position));

    for (let i = 1; i < orderedByPosition.length; i++) {
        const current = orderedByPosition[i];
        const ahead = orderedByPosition[i - 1];
        if (!Number.isFinite(Number(current.interval))
            && Number.isFinite(Number(current.gap_to_leader))
            && Number.isFinite(Number(ahead.gap_to_leader))) {
            current.interval = Number(current.gap_to_leader) - Number(ahead.gap_to_leader);
        }
    }

    // Final fallback for race timing: if an interval sample is unavailable, derive
    // the gap from cumulative completed-lap times when both cars are on the same lap.
    // This is especially useful during live pit/position transitions where OpenF1
    // can temporarily publish null interval values.
    const cumulativeLapTimeByDriver: Record<string, number> = {};
    const completedLapCountByDriver: Record<string, number> = {};
    laps.forEach(l => {
        const d = String(l.driver_number);
        const duration = num(l.lap_duration);
        if (duration > 0) {
            cumulativeLapTimeByDriver[d] = (cumulativeLapTimeByDriver[d] || 0) + duration;
            completedLapCountByDriver[d] = (completedLapCountByDriver[d] || 0) + 1;
        }
    });

    const leaderForTiming = [...driverRows]
        .filter(d => Number(d.position) === 1)
        .sort((a, b) => Number(a.position) - Number(b.position))[0];

    if (leaderForTiming) {
        const leaderNumber = String(leaderForTiming.driver_number);
        const leaderLapCount = completedLapCountByDriver[leaderNumber] || 0;
        const leaderTotal = cumulativeLapTimeByDriver[leaderNumber];

        for (const row of driverRows) {
            if (Number(row.position) === 1) continue;

            const d = String(row.driver_number);
            const lapCount = completedLapCountByDriver[d] || 0;
            const total = cumulativeLapTimeByDriver[d];

            if (!Number.isFinite(Number(row.gap_to_leader))
                && leaderLapCount > 0
                && lapCount === leaderLapCount
                && Number.isFinite(total)
                && Number.isFinite(leaderTotal)) {
                row.gap_to_leader = Math.max(0, total - leaderTotal);
            }
        }

        const timingOrder = [...driverRows]
            .filter(d => Number(d.position) < 99)
            .sort((a, b) => Number(a.position) - Number(b.position));

        for (let i = 1; i < timingOrder.length; i++) {
            const row = timingOrder[i];
            const ahead = timingOrder[i - 1];
            if (!Number.isFinite(Number(row.interval))
                && Number.isFinite(Number(row.gap_to_leader))
                && Number.isFinite(Number(ahead.gap_to_leader))) {
                row.interval = Math.max(0, Number(row.gap_to_leader) - Number(ahead.gap_to_leader));
            }
        }
    }

    const deletedLapIndex = buildDeletedLapIndex(input.raceControl || [], laps);
    const isDeletedLap = (lap: any) =>
        deletedLapIndex.has(`${num(lap.driver_number, -1)}:${num(lap.lap_number, -1)}`);

    const sessionBestsRaw = {
        lap: { time: Infinity, driver: null as any },
        s1: { time: Infinity, driver: null as any },
        s2: { time: Infinity, driver: null as any },
        s3: { time: Infinity, driver: null as any }
    };
    laps.forEach(l => {
        if (isDeletedLap(l)) return;
        const duration = num(l.lap_duration);
        if (duration > 0 && duration < sessionBestsRaw.lap.time) sessionBestsRaw.lap = { time: duration, driver: l.driver_number };
        const s1 = num(l.duration_sector_1), s2 = num(l.duration_sector_2), s3 = num(l.duration_sector_3);
        if (s1 > 0 && s1 < sessionBestsRaw.s1.time) sessionBestsRaw.s1 = { time: s1, driver: l.driver_number };
        if (s2 > 0 && s2 < sessionBestsRaw.s2.time) sessionBestsRaw.s2 = { time: s2, driver: l.driver_number };
        if (s3 > 0 && s3 < sessionBestsRaw.s3.time) sessionBestsRaw.s3 = { time: s3, driver: l.driver_number };
    });
    const driverName = (n: any) => driverInfoByNumber.get(String(n))?.name_acronym || String(n ?? '-');
    const sessionBests = {
        lap: { time: formatLapTime(sessionBestsRaw.lap.time), raw: Number.isFinite(sessionBestsRaw.lap.time) ? sessionBestsRaw.lap.time : null, driver: driverName(sessionBestsRaw.lap.driver) },
        s1: { time: Number.isFinite(sessionBestsRaw.s1.time) ? sessionBestsRaw.s1.time.toFixed(3) : '-', raw: Number.isFinite(sessionBestsRaw.s1.time) ? sessionBestsRaw.s1.time : null, driver: driverName(sessionBestsRaw.s1.driver) },
        s2: { time: Number.isFinite(sessionBestsRaw.s2.time) ? sessionBestsRaw.s2.time.toFixed(3) : '-', raw: Number.isFinite(sessionBestsRaw.s2.time) ? sessionBestsRaw.s2.time : null, driver: driverName(sessionBestsRaw.s2.driver) },
        s3: { time: Number.isFinite(sessionBestsRaw.s3.time) ? sessionBestsRaw.s3.time.toFixed(3) : '-', raw: Number.isFinite(sessionBestsRaw.s3.time) ? sessionBestsRaw.s3.time : null, driver: driverName(sessionBestsRaw.s3.driver) }
    };

    const speedByDriver: Record<string, number> = {};
    laps.forEach(l => {
        const speed = num(l.st_speed);
        const d = String(l.driver_number);
        if (speed > (speedByDriver[d] || 0)) speedByDriver[d] = speed;
    });
    const speedRanks = Object.values(speedByDriver).sort((a, b) => b - a);
    const benchmarkSpeed = speedRanks[0] || 0;

    const isSprintSession = String(sessionInfo.session_name || sessionInfo.session_type || '').toLowerCase().includes('sprint');
    const projectedChampionship = calculateProjectedChampionship(driverRows, championshipDrivers, isSprintSession);

    const sessionYear = Number(sessionInfo.year)
        || (sessionInfo.date_start ? new Date(sessionInfo.date_start).getUTCFullYear() : new Date().getUTCFullYear());
    const sessionFinished = input.sessionFinished ?? (
        (input.raceControl || []).some((message: any) => String(message.flag || '').toUpperCase() === 'CHEQUERED')
        || Boolean(sessionInfo.date_end && parseDate(sessionInfo.date_end) <= Date.now())
    );
    const remainingChampionshipPoints = Number.isFinite(Number(input.remainingChampionshipPoints))
        ? Number(input.remainingChampionshipPoints)
        : Infinity;

    const projectedOrder = Object.values(projectedChampionship)
        .sort((a: any, b: any) => num(b.pointsAfter) - num(a.pointsAfter));
    let clinchedDriverNumber: number | null = null;
    if (sessionFinished && projectedOrder.length > 1 && Number.isFinite(remainingChampionshipPoints)) {
        const leader: any = projectedOrder[0];
        const canStillBeCaught = (projectedOrder.slice(1) as any[]).some(challenger =>
            num(challenger.pointsAfter) + remainingChampionshipPoints >= num(leader.pointsAfter)
        );
        if (!canStillBeCaught) clinchedDriverNumber = num(leader.driver_number, -1);
    }

    type LiveBattleRef = {
        dNum: number;
        name: any;
        pos: number;
        interval: string;
    } | null;

    let results = driverRows.map(row => {
        const dNum = num(row.driver_number);
        const dLapsAll = laps.filter(l => num(l.driver_number) === dNum).sort((a, b) => num(a.lap_number) - num(b.lap_number));
        const completedLaps = dLapsAll.filter(l => num(l.lap_duration) > 0);
        const validCompletedLaps = completedLaps.filter(l => !isDeletedLap(l));
        const dPits = pits.filter(p => num(p.driver_number) === dNum).sort((a, b) => parseDate(a.date) - parseDate(b.date));
        const dStints = stints.filter(s => num(s.driver_number) === dNum).sort((a, b) => num(a.lap_start) - num(b.lap_start));
        const bestLapData = validCompletedLaps.reduce((best, l) => !best || num(l.lap_duration) < num(best.lap_duration) ? l : best, null as any);
        const lastLapData = dLapsAll[dLapsAll.length - 1] || null;
        const completedLapNumber = completedLaps.length ? Math.max(...completedLaps.map(l => num(l.lap_number))) : 0;
        const startedLapNumber = dLapsAll.length ? Math.max(...dLapsAll.map(l => num(l.lap_number))) : 0;

        const driverPositions = positions
            .filter(p => num(p.driver_number) === dNum)
            .sort((a, b) => parseDate(a.date) - parseDate(b.date));

        const lapsHistory = completedLaps.map(l => {
            const end = parseDate(l.date_start) + num(l.lap_duration) * 1000;
            let positionAtEnd = num(initialPositions[String(dNum)]?.position, 99);
            for (const p of driverPositions) {
                if (parseDate(p.date) <= end) positionAtEnd = num(p.position, positionAtEnd);
                else break;
            }
            const deletion = deletedLapIndex.get(`${dNum}:${num(l.lap_number)}`) || null;
            return {
                lap_number: num(l.lap_number),
                lap_duration: num(l.lap_duration),
                position: positionAtEnd,
                is_deleted: Boolean(deletion),
                deleted_reason: deletion?.reason || null,
                deleted_message: deletion?.message || null
            };
        });

        const stintLapLimit = startedLapNumber || completedLapNumber || maxRaceLap;
        const tyreHistory = buildTyreHistory(dStints, dPits, stintLapLimit);
        const mappedStints = tyreHistory.stints;

        const officialPosition = num(latestPositions[String(dNum)]?.position, 99);
        const startingPosition = num(initialPositions[String(dNum)]?.position, officialPosition);
        const explicitOut = /DNF|OUT|RETIRED/.test(String(row.gap_to_leader || '').toUpperCase() + ' ' + String(row.interval || '').toUpperCase());
        const status = row.dns ? 'DNS' : row.dnf || row.dsq || explicitOut ? 'DNF' : (isRace && completedLapNumber === 0 && maxRaceLap > 3 ? 'DNS' : (isRace && maxRaceLap > 5 && maxRaceLap - completedLapNumber > 4 ? 'DNF' : 'Active'));

        const totalSeconds = completedLaps.reduce((sum, l) => sum + num(l.lap_duration), 0);
        const carTotalTime = isRace && totalSeconds > 0
            ? `${Math.floor(totalSeconds / 3600) > 0 ? Math.floor(totalSeconds / 3600) + ':' : ''}${String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0')}:${(totalSeconds % 60).toFixed(3).padStart(6, '0')}`
            : '-';

        const activeStint = mappedStints[mappedStints.length - 1] || null;
        const currentCompound = activeStint?.compound || 'UNKNOWN';
        const stintStart = num(activeStint?.start ?? activeStint?.lap_start, 1);
        const currentStintLength = Math.max(0, startedLapNumber - stintStart + 1);
        const currentTyreAge = currentStintLength + num(activeStint?.tyre_age_at_start);
        const compoundMax = stints.filter(s => s.compound).reduce((acc: Record<string, number>, s) => {
            const compound = s.compound;
            acc[compound] = Math.max(acc[compound] || 0, num(s.lap_end || 999) - num(s.lap_start) + 1);
            return acc;
        }, {});
        const maxLapsOnCompound = Math.max(5, compoundMax[currentCompound] || (currentCompound === 'SOFT' ? 20 : currentCompound === 'MEDIUM' ? 30 : 40));

        const currentStintLaps = completedLaps.filter(l => num(l.lap_number) >= stintStart);
        const paceDropOff = currentStintLaps.length > 2
            ? (num(currentStintLaps[currentStintLaps.length - 1].lap_duration) - num(currentStintLaps[1].lap_duration)) / Math.max(1, currentStintLaps.length - 2)
            : 0;

        const driverSpeed = speedByDriver[String(dNum)] || 0;
        const speedRank = driverSpeed ? speedRanks.indexOf(driverSpeed) + 1 : '-';
        const last5 = completedLaps.slice(-5).map(l => num(l.lap_duration));
        const mean = last5.length ? last5.reduce((a, b) => a + b, 0) / last5.length : 0;
        const variance = last5.length > 1 ? last5.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / last5.length : 0;
        const consistencyStdDev = Math.sqrt(variance);
        const championship = projectedChampionship[String(dNum)] || {
            pointsStart: 0, posStart: '-', pointsAfter: 0, pointsAddition: 0, projectedPos: '-', posChange: 0, isFinished: false
        };

        const lastSectors = lastLapData ? {
            s1: lastLapData.duration_sector_1, s2: lastLapData.duration_sector_2, s3: lastLapData.duration_sector_3,
            i1_speed: lastLapData.i1_speed, i2_speed: lastLapData.i2_speed, st_speed: lastLapData.st_speed,
            seg1: lastLapData.segments_sector_1 || [], seg2: lastLapData.segments_sector_2 || [], seg3: lastLapData.segments_sector_3 || []
        } : null;
        const bestSectors = bestLapData ? {
            s1: bestLapData.duration_sector_1, s2: bestLapData.duration_sector_2, s3: bestLapData.duration_sector_3,
            i1_speed: bestLapData.i1_speed, i2_speed: bestLapData.i2_speed, st_speed: bestLapData.st_speed,
            seg1: bestLapData.segments_sector_1 || [], seg2: bestLapData.segments_sector_2 || [], seg3: bestLapData.segments_sector_3 || []
        } : null;

        return {
            driver_number: dNum,
            name: row.full_name || row.name || row.name_acronym || `Unknown (${dNum})`,
            team_name: row.team_name,
            team_color: row.team_colour || row.team_color || 'ffffff',
            total_time: carTotalTime,
            interval: isRace ? (officialPosition === 1 ? '-' : formatGap(row.interval)) : '-',
            gap_to_leader: isRace ? (officialPosition === 1 ? '-' : formatGap(row.gap_to_leader)) : '-',
            position: officialPosition,
            official_position: officialPosition,
            starting_position: startingPosition,
            pos_change: startingPosition === 99 || officialPosition === 99 ? 0 : startingPosition - officialPosition,
            status,
            driver_laps: completedLapNumber,
            completed_laps: completedLapNumber,
            current_lap: startedLapNumber,
            partial_lap_progress: calculatePartialLapProgress(lastLapData),
            best_lap_raw: bestLapData ? num(bestLapData.lap_duration) : Infinity,
            best_lap: formatLapTime(bestLapData ? num(bestLapData.lap_duration) : null),
            last_lap: lastLapData && num(lastLapData.lap_duration) > 0 ? formatLapTime(num(lastLapData.lap_duration)) : '-',
            best_sectors: bestSectors,
            last_sectors: lastSectors,
            stints: mappedStints,
            pit_stops: dPits.map(p => ({
                lap: num(p.lap_number),
                pit_duration: p.pit_duration ?? p.lane_duration ?? null,
                lane_duration: p.lane_duration ?? p.pit_duration ?? null,
                stop_duration: p.stop_duration ?? null
            })),
            analytics: {
                currentCompound,
                currentStintLength,
                currentTyreAge,
                maxLapsOnCompound,
                paceDropOff,
                driverSpeed,
                speedRank,
                speedDeficit: Math.max(0, benchmarkSpeed - driverSpeed),
                consistencyStdDev
            },
            liveBattle: {
                target: null as LiveBattleRef,
                threat: null as LiveBattleRef
            },
            latestPit: dPits.length ? { ...dPits[dPits.length - 1], lap: num(dPits[dPits.length - 1].lap_number ?? dPits[dPits.length - 1].lap) } : null,
            championship,
            champion_status: getChampionStatus(
                row.full_name || row.name || row.name_acronym,
                sessionYear,
                clinchedDriverNumber === dNum
            ),
            tyreHistory,
            lapsHistory
        };
    });

    if (isRace) {
        results.sort((a, b) => num(a.position, 99) - num(b.position, 99));
        results.forEach((r, index) => {
            if (r.position === 99) r.position = index + 1;
        });
        results.forEach((r, index) => {
            const previous = results[index - 1];
            if (r.position === 1) {
                r.interval = '-';
                r.gap_to_leader = '-';
            } else if (previous && previous.gap_to_leader?.includes('LAP') && r.gap_to_leader === '-') {
                r.gap_to_leader = previous.gap_to_leader;
            }
        });
    } else {
        results.sort((a, b) => num(a.best_lap_raw, Infinity) - num(b.best_lap_raw, Infinity));
        const leader = results[0]?.best_lap_raw;
        results.forEach((r, index) => {
            r.position = index + 1;
            if (!Number.isFinite(r.best_lap_raw)) {
                r.gap_to_leader = 'No Time';
                r.interval = '-';
            } else if (index === 0) {
                r.gap_to_leader = 'Leader';
                r.interval = 'Leader';
            } else {
                r.gap_to_leader = `+${(r.best_lap_raw - leader).toFixed(3)}s`;
                r.interval = `+${(r.best_lap_raw - num(results[index - 1].best_lap_raw)).toFixed(3)}s`;
            }
        });
    }

    // Populate live battle references after the final race ordering is known.
    const byPos = [...results].sort((a, b) => num(a.position, 99) - num(b.position, 99));
    results.forEach(r => {
        const idx = byPos.findIndex(x => x.driver_number === r.driver_number);
        r.liveBattle = {
            target: idx > 0 ? { dNum: byPos[idx - 1].driver_number, name: byPos[idx - 1].name, pos: byPos[idx - 1].position, interval: byPos[idx - 1].interval } : null,
            threat: idx >= 0 && idx < byPos.length - 1 ? { dNum: byPos[idx + 1].driver_number, name: byPos[idx + 1].name, pos: byPos[idx + 1].position, interval: byPos[idx + 1].interval } : null
        };
    });

    return {
        weather: input.weather || null,
        sessionBests,
        isRace,
        maxRaceLap,
        scheduledTotalLaps: Number.isFinite(Number(input.scheduledTotalLaps)) && Number(input.scheduledTotalLaps) > 0
            ? Number(input.scheduledTotalLaps)
            : null,
        availableSessions: input.availableSessions || [],
        sessionName: sessionInfo.session_name || sessionInfo.session_type || 'Session',
        sessionInfo,
        meetingInfo: input.meetingInfo || null,
        circuitInfo: input.circuitInfo || null,
        results,
        raceControl: [...(input.raceControl || [])].sort((a, b) => parseDate(b.date) - parseDate(a.date)),
        championshipDrivers,
        championshipTeams: input.championshipTeams || [],
        championshipMeta: {
            sessionYear,
            remainingChampionshipPoints: Number.isFinite(remainingChampionshipPoints) ? remainingChampionshipPoints : null,
            clinchedDriverNumber
        }
    };
};
