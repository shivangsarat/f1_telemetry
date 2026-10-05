export type RaceCalculationInput = {
    sessionInfo?: any;
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
    const pitStops = rawPitStops
        .map(p => ({ ...p, lap: num(p.lap_number ?? p.lap) }))
        .filter(p => p.lap > 0)
        .sort((a, b) => a.lap - b.lap);

    const sourceStints = rawStints
        .filter(s => num(s.lap_start) > 0)
        .sort((a, b) => num(a.lap_start) - num(b.lap_start));

    const stints: any[] = [];
    sourceStints.forEach((source, index) => {
        const start = num(source.lap_start);
        const nextStart = sourceStints[index + 1] ? num(sourceStints[index + 1].lap_start) : undefined;
        let end = num(source.lap_end);
        if (!end || end > lapLimit) end = nextStart ? nextStart - 1 : lapLimit;
        if (nextStart !== undefined) end = Math.min(end, nextStart - 1);
        if (end < start) return;

        const splitStarts = pitStops
            .map(p => p.lap + 1)
            .filter(l => l > start && l <= end);

        const boundaries = [start, ...Array.from(new Set(splitStarts)).sort((a, b) => a - b), end + 1];
        for (let i = 0; i < boundaries.length - 1; i++) {
            const miniStart = boundaries[i];
            const miniEnd = boundaries[i + 1] - 1;
            if (miniEnd < miniStart) continue;
            stints.push({
                compound: source.compound || 'UNKNOWN',
                start: miniStart,
                end: miniEnd,
                length: miniEnd - miniStart + 1,
                tyre_age_at_start: num(source.tyre_age_at_start) + miniStart - start,
                has_pit_before: pitStops.some(p => p.lap + 1 === miniStart)
            });
        }
    });

    return {
        stints,
        pitStops: pitStops.map(p => {
            const nextStint = stints.find(s => s.start === p.lap + 1);
            return {
                ...p,
                next_stint: nextStint ? {
                    compound: nextStint.compound,
                    start: nextStint.start,
                    end: nextStint.end,
                    length: nextStint.length
                } : null
            };
        })
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

export const buildTelemetryHistory = (carData: any[] = [], laps: any[] = []) => {
    const orderedLaps = [...laps].sort((a, b) => num(a.lap_number) - num(b.lap_number));
    if (!orderedLaps.length) return [];

    const completed = orderedLaps.filter(l => num(l.lap_duration) > 0 && l.date_start);
    const lastCompletedDuration = completed.length ? num(completed[completed.length - 1].lap_duration, 90) : 90;
    const points = [...carData]
        .filter(t => t.date)
        .sort((a, b) => parseDate(a.date) - parseDate(b.date))
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

            return {
                lapX,
                speed: num(t.speed),
                throttle: num(t.throttle),
                brake: num(t.brake),
                rpm: num(t.rpm),
                gear: num(t.n_gear),
                drs: t.drs ?? 0
            };
        })
        .filter(Boolean) as any[];

    const result: any[] = [];
    let lastX = -1;
    for (const point of points.sort((a, b) => a.lapX - b.lapX)) {
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

    const maxRaceLap = Math.max(
        1,
        ...laps.map(l => num(l.lap_number)),
        ...stints.map(s => num(s.lap_end || s.lap_start))
    );

    const driverNumbers = new Set<number>();
    [drivers, intervals, positions, laps, stints, pits, championshipDrivers].forEach(rows => rows.forEach(row => {
        const d = num(row.driver_number, -1);
        if (d > 0) driverNumbers.add(d);
    }));

    const driverInfoByNumber = new Map(drivers.map(d => [String(d.driver_number), d]));
    const sessionResultByDriver = new Map(sessionResults.map(row => [String(row.driver_number), row]));
    const driverRows = [...driverNumbers].map(d => {
        const info = driverInfoByNumber.get(String(d)) || {};
        const interval = latestIntervals[String(d)] || {};
        const result = sessionResultByDriver.get(String(d)) || {};
        const position = num(latestPositions[String(d)]?.position, num(result.position, num(initialPositions[String(d)]?.position, 99)));
        return { ...info, ...interval, ...result, driver_number: d, position };
    });

    const sessionBestsRaw = {
        lap: { time: Infinity, driver: null as any },
        s1: { time: Infinity, driver: null as any },
        s2: { time: Infinity, driver: null as any },
        s3: { time: Infinity, driver: null as any }
    };
    laps.forEach(l => {
        const duration = num(l.lap_duration);
        if (duration > 0 && duration < sessionBestsRaw.lap.time) sessionBestsRaw.lap = { time: duration, driver: l.driver_number };
        const s1 = num(l.duration_sector_1), s2 = num(l.duration_sector_2), s3 = num(l.duration_sector_3);
        if (s1 > 0 && s1 < sessionBestsRaw.s1.time) sessionBestsRaw.s1 = { time: s1, driver: l.driver_number };
        if (s2 > 0 && s2 < sessionBestsRaw.s2.time) sessionBestsRaw.s2 = { time: s2, driver: l.driver_number };
        if (s3 > 0 && s3 < sessionBestsRaw.s3.time) sessionBestsRaw.s3 = { time: s3, driver: l.driver_number };
    });
    const driverName = (n: any) => driverInfoByNumber.get(String(n))?.name_acronym || String(n ?? '-');
    const sessionBests = {
        lap: { time: formatLapTime(sessionBestsRaw.lap.time), driver: driverName(sessionBestsRaw.lap.driver) },
        s1: { time: Number.isFinite(sessionBestsRaw.s1.time) ? sessionBestsRaw.s1.time.toFixed(3) : '-', driver: driverName(sessionBestsRaw.s1.driver) },
        s2: { time: Number.isFinite(sessionBestsRaw.s2.time) ? sessionBestsRaw.s2.time.toFixed(3) : '-', driver: driverName(sessionBestsRaw.s2.driver) },
        s3: { time: Number.isFinite(sessionBestsRaw.s3.time) ? sessionBestsRaw.s3.time.toFixed(3) : '-', driver: driverName(sessionBestsRaw.s3.driver) }
    };

    const speedByDriver: Record<string, number> = {};
    laps.forEach(l => {
        const speed = num(l.st_speed);
        const d = String(l.driver_number);
        if (speed > (speedByDriver[d] || 0)) speedByDriver[d] = speed;
    });
    const speedRanks = Object.values(speedByDriver).sort((a, b) => b - a);
    const benchmarkSpeed = speedRanks[0] || 0;

    const projectedChampionship = calculateProjectedChampionship(driverRows, championshipDrivers, false);

    let results = driverRows.map(row => {
        const dNum = num(row.driver_number);
        const dLapsAll = laps.filter(l => num(l.driver_number) === dNum).sort((a, b) => num(a.lap_number) - num(b.lap_number));
        const completedLaps = dLapsAll.filter(l => num(l.lap_duration) > 0);
        const dPits = pits.filter(p => num(p.driver_number) === dNum).sort((a, b) => parseDate(a.date) - parseDate(b.date));
        const dStints = stints.filter(s => num(s.driver_number) === dNum).sort((a, b) => num(a.lap_start) - num(b.lap_start));
        const bestLapData = completedLaps.reduce((best, l) => !best || num(l.lap_duration) < num(best.lap_duration) ? l : best, null as any);
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
            return { lap_number: num(l.lap_number), lap_duration: num(l.lap_duration), position: positionAtEnd };
        });

        const mappedStints = dStints.map((s, idx, arr) => {
            const start = num(s.lap_start);
            let end = num(s.lap_end);
            const nextStart = arr[idx + 1] ? num(arr[idx + 1].lap_start) : 0;
            if (nextStart > start) end = nextStart - 1;
            if (!end || end > maxRaceLap) end = startedLapNumber || maxRaceLap;
            return {
                compound: s.compound || 'UNKNOWN',
                start,
                end,
                length: Math.max(1, end - start + 1),
                tyre_age_at_start: num(s.tyre_age_at_start)
            };
        });

        const officialPosition = num(latestPositions[String(dNum)]?.position, 99);
        const startingPosition = num(initialPositions[String(dNum)]?.position, officialPosition);
        const explicitOut = /DNF|OUT|RETIRED/.test(String(row.gap_to_leader || '').toUpperCase() + ' ' + String(row.interval || '').toUpperCase());
        const status = row.dns ? 'DNS' : row.dnf || row.dsq || explicitOut ? 'DNF' : (isRace && completedLapNumber === 0 && maxRaceLap > 3 ? 'DNS' : (isRace && maxRaceLap > 5 && maxRaceLap - completedLapNumber > 4 ? 'DNF' : 'Active'));

        const totalSeconds = completedLaps.reduce((sum, l) => sum + num(l.lap_duration), 0);
        const carTotalTime = isRace && totalSeconds > 0
            ? `${Math.floor(totalSeconds / 3600) > 0 ? Math.floor(totalSeconds / 3600) + ':' : ''}${String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0')}:${(totalSeconds % 60).toFixed(3).padStart(6, '0')}`
            : '-';

        const activeStint = dStints[dStints.length - 1] || null;
        const currentCompound = activeStint?.compound || 'UNKNOWN';
        const stintStart = num(activeStint?.lap_start, 1);
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
        const tyreHistory = buildTyreHistory(dStints, dPits, maxRaceLap);
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
            liveBattle: { target: null, threat: null },
            latestPit: dPits.length ? { ...dPits[dPits.length - 1], lap: num(dPits[dPits.length - 1].lap_number ?? dPits[dPits.length - 1].lap) } : null,
            championship,
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
        availableSessions: input.availableSessions || [],
        sessionName: sessionInfo.session_name || sessionInfo.session_type || 'Session',
        sessionInfo,
        results,
        raceControl: [...(input.raceControl || [])].sort((a, b) => parseDate(b.date) - parseDate(a.date)),
        championshipDrivers,
        championshipTeams: input.championshipTeams || []
    };
};
