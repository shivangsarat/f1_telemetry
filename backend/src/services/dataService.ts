import axios from 'axios';
import { CONFIG, OPENF1_BASE, ERGAST_BASE } from '../config';
import { processTelemetry } from './telemetryProcessor';

// --- NEW AUTHENTICATION MANAGER ---
let sharedToken: string | null = null;
let tokenExpiry = 0;

const getOpenF1Token = async () => {
    if (CONFIG.LIVE_PROVIDER !== 'OPENF1_PAID' || !CONFIG.OPENF1_USERNAME) return null;
    if (sharedToken && Date.now() < tokenExpiry) return sharedToken;

    const params = new URLSearchParams();
    params.append('username', CONFIG.OPENF1_USERNAME);
    params.append('password', CONFIG.OPENF1_PASSWORD);

    try {
        const res = await axios.post(CONFIG.OPENF1_TOKEN_URL, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        sharedToken = res.data.access_token;
        const expiresIn = parseInt(res.data.expires_in, 10) || 3600;
        tokenExpiry = Date.now() + (expiresIn - 300) * 1000;
        return sharedToken;
    } catch (e) {
        console.warn('⚠️ Failed to fetch OpenF1 token for REST APIs. Using public tier.');
        return null;
    }
};

const openF1Request = async (url: string) => {
    const token = await getOpenF1Token();
    const headers = token ? { 'Authorization': `Bearer ${token}`, 'User-Agent': 'F1-Dash/1.0' } : {};
    return axios.get(url, { headers });
};
// ----------------------------------

const cache = new Map<string, { data: any, expires: number }>();
cache.clear();
const pendingRequests = new Map<string, Promise<any>>();
let globalRequestQueue: Promise<any> = Promise.resolve();

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let lastRequestTime = 0;

const enqueueRequest = <T>(fetcher: () => Promise<T>): Promise<T> => {
    const execute = globalRequestQueue.then(async () => {
        const now = Date.now();
        const timeSinceLast = now - lastRequestTime;
        
        // GUARDRAIL 2: Enforce at least 500ms between ANY REST endpoint call
        if (timeSinceLast < 500) {
            await sleep(500 - timeSinceLast);
        }
        
        lastRequestTime = Date.now();
        return fetcher();
    });
    globalRequestQueue = execute.catch(() => {}); 
    return execute as Promise<T>;
};

const getCached = async (key: string, ttlMs: number, fetcher: () => Promise<any>) => {
    const now = Date.now();
    if (cache.has(key) && cache.get(key)!.expires > now) return cache.get(key)!.data;
    if (pendingRequests.has(key)) return pendingRequests.get(key);

    const requestPromise = (async () => {
        try {
            const res = await enqueueRequest(fetcher);
            
            if (res.data && (!Array.isArray(res.data) || res.data.length > 0)) {
                cache.set(key, { data: res, expires: Date.now() + ttlMs });
            }
            
            return res;
        } catch (e: any) {
            if (e.response?.status === 429) {
                console.warn(`Rate limit hit on ${key}, queuing retry...`);
                await sleep(1500); 
                try {
                    const retryRes = await enqueueRequest(fetcher);
                    if (retryRes.data && (!Array.isArray(retryRes.data) || retryRes.data.length > 0)) {
                        cache.set(key, { data: retryRes, expires: Date.now() + ttlMs });
                    }
                    return retryRes;
                } catch (err) {
                    return cache.has(key) ? cache.get(key)!.data : { data: [] };
                }
            }
            return cache.has(key) ? cache.get(key)!.data : { data: [] };
        } finally {
            pendingRequests.delete(key);
        }
    })();

    pendingRequests.set(key, requestPromise);
    return requestPromise;
};

const formatGap = (gap: any) => {
    if (gap === null || gap === undefined || gap === '') return '-';
    if (typeof gap === 'string' && gap.toUpperCase().includes('LAP')) return gap;
    const num = Number(gap);
    if (isNaN(num)) return '-';
    return `+${num.toFixed(3)}s`;
};

const formatLapTime = (seconds: number | null) => {
    if (!seconds || isNaN(seconds) || seconds === Infinity) return '-';
    const m = Math.floor(seconds / 60);
    const s = (seconds % 60).toFixed(3);
    return m > 0 ? `${m}:${s.padStart(6, '0')}` : `${s}s`;
};

const buildTyreHistory = (
    rawStints: any[],
    rawPitStops: any[],
    lapLimit: number
) => {
    // Use OpenF1's lap_number field, with lap as a compatibility fallback.
    // Deduplicate exact duplicate records, but retain separate same-compound stops.
    const seenPitStops = new Set<string>();
    const pitStops = (Array.isArray(rawPitStops) ? rawPitStops : [])
        .map((pit: any) => ({
            ...pit,
            lap: Number(pit.lap_number ?? pit.lap),
        }))
        .filter((pit: any) => Number.isFinite(pit.lap) && pit.lap > 0)
        .filter((pit: any) => {
            const key = [
                pit.lap,
                pit.date ?? '',
                pit.stop_duration ?? '',
                pit.lane_duration ?? pit.pit_duration ?? '',
            ].join('|');

            if (seenPitStops.has(key)) return false;
            seenPitStops.add(key);
            return true;
        })
        .sort((a: any, b: any) => a.lap - b.lap);

    // Remove exact duplicate stint records, but do not merge by compound:
    // two SOFT records can represent separate sets and must stay separate.
    const seenStints = new Set<string>();
    const sourceStints = (Array.isArray(rawStints) ? rawStints : [])
        .filter((stint: any) => Number(stint.lap_start) > 0)
        .filter((stint: any) => {
            const key = [
                stint.stint_number ?? '',
                stint.compound ?? '',
                stint.lap_start,
                stint.lap_end ?? '',
                stint.tyre_age_at_start ?? '',
            ].join('|');

            if (seenStints.has(key)) return false;
            seenStints.add(key);
            return true;
        })
        .sort((a: any, b: any) => Number(a.lap_start) - Number(b.lap_start));

    const stints: any[] = [];

    sourceStints.forEach((source: any, index: number) => {
        const start = Number(source.lap_start);
        const nextStart = sourceStints
            .slice(index + 1)
            .map((next: any) => Number(next.lap_start))
            .find((nextStart: number) => nextStart > start);

        const reportedEnd = Number(source.lap_end);
        let end = reportedEnd > 0
            ? Math.min(reportedEnd, lapLimit)
            : Math.min((nextStart ?? lapLimit + 1) - 1, lapLimit);

        // Keep overlapping source records from making overlapping bar segments.
        if (nextStart !== undefined) {
            end = Math.min(end, nextStart - 1);
        }

        if (end < start) return;

        // A pit on lap N normally means the new tyres are used from lap N+1.
        // Split even when the compound stays the same.
        const splitStarts = [...new Set(
            pitStops
                .map((pit: any) => pit.lap + 1)
                .filter((lap: number) => lap > start && lap <= end)
        )].sort((a, b) => a - b);

        const boundaries = [start, ...splitStarts, end + 1];

        for (let i = 0; i < boundaries.length - 1; i++) {
            const miniStart = boundaries[i];
            const miniEnd = boundaries[i + 1] - 1;

            if (miniEnd < miniStart) continue;

            stints.push({
                compound: source.compound || 'UNKNOWN',
                start: miniStart,
                end: miniEnd,
                length: miniEnd - miniStart + 1,
                tyre_age_at_start:
                    Number(source.tyre_age_at_start) +
                    (miniStart - start),
                // Used to show a pit marker on the tyre timeline only when
                // there is an actual pit record for this boundary.
                has_pit_before: pitStops.some(
                    (pit: any) => pit.lap + 1 === miniStart
                ),
            });
        }
    });

    // Keep every actual pit stop; attach its following tyre mini-stint if one
    // starts on the next lap. Unmatched pit stops still remain in this list.
    const matchedPitStops = pitStops.map((pit: any) => {
        const nextStint = stints.find(
            (stint: any) => stint.start === pit.lap + 1
        );

        return {
            ...pit,
            next_stint: nextStint
                ? {
                    compound: nextStint.compound,
                    start: nextStint.start,
                    end: nextStint.end,
                    length: nextStint.length,
                }
                : null,
        };
    });

    return { stints, pitStops: matchedPitStops };
};

export const getHomeData = async () => {
    const currentYear = new Date().getFullYear();

    const [liveRes, driversRes, teamsRes] = await Promise.all([
        getCached('live_status', 30000, () => openF1Request(`${OPENF1_BASE}/sessions?session_key=latest`)),
        getCached('drivers_std', 600000, () => axios.get(`${ERGAST_BASE}/current/driverStandings.json`)),
        getCached('teams_std', 600000, () => axios.get(`${ERGAST_BASE}/current/constructorStandings.json`))
    ]);

    let meetingsRes = await getCached(`meetings_${currentYear}`, 600000, () => openF1Request(`${OPENF1_BASE}/meetings?year=${currentYear}`));
    let sessionsRes = await getCached(`sessions_race_${currentYear}`, 600000, () => openF1Request(`${OPENF1_BASE}/sessions?year=${currentYear}&session_name=Race`));

    if (!meetingsRes?.data || meetingsRes.data.length === 0) {
        console.warn(`No calendar data found for ${currentYear}. Falling back to 2024 calendar...`);
        meetingsRes = await getCached('meetings_2024', 600000, () => openF1Request(`${OPENF1_BASE}/meetings?year=2024`));
        sessionsRes = await getCached('sessions_race_2024', 600000, () => openF1Request(`${OPENF1_BASE}/sessions?year=2024&session_name=Race`));
    }

    const driversData = driversRes?.data?.MRData?.StandingsTable?.StandingsLists[0]?.DriverStandings || [];
    const drivers = driversData.map((d: any, idx: number) => ({
        position: d.position, 
        name: `${d.Driver.givenName} ${d.Driver.familyName}`, 
        team: d.Constructors[0]?.name, 
        points: d.points,
        diff_to_next: idx === 0 ? '-' : `-${Number(driversData[idx-1].points) - Number(d.points)}`
    }));

    const teamsData = teamsRes?.data?.MRData?.StandingsTable?.StandingsLists[0]?.ConstructorStandings || [];
    const teams = teamsData.map((t: any, idx: number) => ({
        position: t.position, 
        name: t.Constructor.name, 
        points: t.points,
        diff_to_next: idx === 0 ? '-' : `-${Number(teamsData[idx-1].points) - Number(t.points)}`
    }));

    const races = (meetingsRes?.data || []).map((m: any) => {
        const race = sessionsRes?.data?.find((s: any) => s.meeting_key === m.meeting_key);
        return race ? { round: m.meeting_name, location: m.location, date: m.date_start, session_key: race.session_key } : null;
    }).filter(Boolean);

    const now = Date.now();
    const pastRaces = races.filter((r: any) => new Date(r.date).getTime() <= now).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const upcomingRaces = races.filter((r: any) => new Date(r.date).getTime() > now).sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let liveStatus = { isLive: false, session_key: null, type: '' };
    if (liveRes?.data?.[0]) {
        const s = liveRes.data[0];
        const end = new Date(s.date_end).getTime();
        liveStatus = { isLive: now >= new Date(s.date_start).getTime() && (isNaN(end) || now <= end), session_key: s.session_key, type: s.session_name };
    }

    return { drivers, teams, pastRaces, upcomingRaces, liveStatus };
};

export const getRaceDetails = async (sessionKey: string) => {
    const ttl = sessionKey === 'latest' ? 5000 : 86400000; 
    let availableSessions: any[] = [];
    let sessionName = 'Live Session';
    
    if (sessionKey !== 'latest') {
        const sInfoRes = await getCached(`session_info_${sessionKey}`, ttl, () => openF1Request(`${OPENF1_BASE}/sessions?session_key=${sessionKey}`));
        const sessionInfo = sInfoRes.data[0] || {};
        sessionName = sessionInfo.session_name || 'Session';
        
        if (sessionInfo.meeting_key) {
            const meetingSessionsRes = await getCached(`meeting_sessions_${sessionInfo.meeting_key}`, ttl, () => openF1Request(`${OPENF1_BASE}/sessions?meeting_key=${sessionInfo.meeting_key}`));
            availableSessions = (meetingSessionsRes.data || []).sort((a: any, b: any) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime());
            
            const now = Date.now();
            if (new Date(sessionInfo.date_start).getTime() > now) {
                const pastSessions = availableSessions.filter((s: any) => new Date(s.date_start).getTime() <= now);
                if (pastSessions.length > 0) {
                    return { active_session_key: String(pastSessions[pastSessions.length - 1].session_key) };
                }
            }
        }
    }

    const activeSessionInfoRes = await getCached(`session_info_${sessionKey}`, ttl, () => openF1Request(`${OPENF1_BASE}/sessions?session_key=${sessionKey}`));
    const activeSessionInfo = activeSessionInfoRes.data[0] || {};
    const isRace = activeSessionInfo.session_type?.includes('Race') || activeSessionInfo.session_type?.includes('Sprint');
    sessionName = activeSessionInfo.session_name || sessionName;

    // --- STAGGERED SEQUENTIAL FETCHING TO PREVENT 429 RATE LIMITS ---
    const wRes = await getCached(`weather_${sessionKey}`, ttl, () => openF1Request(`${OPENF1_BASE}/weather?session_key=${sessionKey}`));
    await sleep(400);
    const iRes = await getCached(`intervals_${sessionKey}`, ttl, () => openF1Request(`${OPENF1_BASE}/intervals?session_key=${sessionKey}`));
    await sleep(400);
    const posRes = await getCached(`positions_${sessionKey}`, ttl, () => openF1Request(`${OPENF1_BASE}/position?session_key=${sessionKey}`));
    await sleep(400);
    const dRes = await getCached(`drivers_${sessionKey}`, 86400000, () => openF1Request(`${OPENF1_BASE}/drivers?session_key=${sessionKey}`));
    await sleep(400);
    const pRes = await getCached(`pits_${sessionKey}`, ttl, () => openF1Request(`${OPENF1_BASE}/pit?session_key=${sessionKey}`));
    await sleep(400);
    const lRes = await getCached(`laps_${sessionKey}`, ttl, () => openF1Request(`${OPENF1_BASE}/laps?session_key=${sessionKey}`));
    await sleep(400);
    const sRes = await getCached(`stints_${sessionKey}`, ttl, () => openF1Request(`${OPENF1_BASE}/stints?session_key=${sessionKey}`));
    await sleep(400);
    const driversStd = await getCached('drivers_std', 600000, () => openF1Request(`${OPENF1_BASE}/championship_drivers?session_key=${sessionKey}`));

    const weather = wRes.data[wRes.data.length - 1] || null;
    
    const lapsFromLaps = Math.max(...(lRes.data || []).map((l: any) => l.lap_number || 0), 0);
    const lapsFromStints = Math.max(...(sRes.data || []).map((s: any) => s.lap_end || s.lap_start || 0), 0);
    const maxRaceLap = Math.max(lapsFromLaps, lapsFromStints, 1);

    const championshipDrivers = Array.isArray(driversStd?.data)
    ? driversStd.data
    : [];

    const getDriverStandings = (driverNumber: number) => {
        const driverStanding = championshipDrivers.find((d: any) => Number(d.driver_number) === driverNumber);
        return driverStanding ? { position: driverStanding.position_start, pointsStart: driverStanding.points_start, points: driverStanding.points_current, positionEnd: driverStanding.position_current } : { position: '-', pointsStart: '-', points: '-', positionEnd: '-' };
    };
    
    const latestPositions = (posRes.data || []).reduce((acc: any, c: any) => {
        if (!acc[c.driver_number] || new Date(c.date).getTime() > new Date(acc[c.driver_number].date).getTime()) acc[c.driver_number] = c;
        return acc;
    }, {});
    
    const initialPositions = (posRes.data || []).reduce((acc: any, c: any) => {
        if (!acc[c.driver_number] || new Date(c.date).getTime() < new Date(acc[c.driver_number].date).getTime()) acc[c.driver_number] = c;
        return acc;
    }, {});

    let sessionBests = { lap: { time: Infinity, driver: null, formatted: '-' }, s1: { time: Infinity, driver: null }, s2: { time: Infinity, driver: null }, s3: { time: Infinity, driver: null } };
    (lRes.data || []).forEach((lap: any) => {
        if (lap.lap_duration && lap.lap_duration < sessionBests.lap.time) sessionBests.lap = { time: lap.lap_duration, driver: lap.driver_number, formatted: formatLapTime(lap.lap_duration) };
        if (lap.duration_sector_1 && lap.duration_sector_1 < sessionBests.s1.time) sessionBests.s1 = { time: lap.duration_sector_1, driver: lap.driver_number };
        if (lap.duration_sector_2 && lap.duration_sector_2 < sessionBests.s2.time) sessionBests.s2 = { time: lap.duration_sector_2, driver: lap.driver_number };
        if (lap.duration_sector_3 && lap.duration_sector_3 < sessionBests.s3.time) sessionBests.s3 = { time: lap.duration_sector_3, driver: lap.driver_number };
    });

    const getDriverName = (dNum: number) => {
        const d = dRes.data.find((x: any) => Number(x.driver_number) === dNum);
        return d ? d.name_acronym || d.last_name || String(dNum) : String(dNum);
    };

    const formattedBests = {
        lap: { time: sessionBests.lap.formatted, driver: getDriverName(Number(sessionBests.lap.driver)) },
        s1: { time: sessionBests.s1.time !== Infinity ? sessionBests.s1.time.toFixed(3) : '-', driver: getDriverName(Number(sessionBests.s1.driver)) },
        s2: { time: sessionBests.s2.time !== Infinity ? sessionBests.s2.time.toFixed(3) : '-', driver: getDriverName(Number(sessionBests.s2.driver)) },
        s3: { time: sessionBests.s3.time !== Infinity ? sessionBests.s3.time.toFixed(3) : '-', driver: getDriverName(Number(sessionBests.s3.driver)) }
    };

    const driverList = isRace ? Object.values(iRes.data.reduce((acc: any, c: any) => {
        const existing = acc[c.driver_number] || {};
        return {
            ...acc,
            [c.driver_number]: {
                ...existing,
                ...c,
                interval: (c.interval !== null && c.interval !== undefined && c.interval !== '') ? c.interval : existing.interval,
                gap_to_leader: (c.gap_to_leader !== null && c.gap_to_leader !== undefined && c.gap_to_leader !== '') ? c.gap_to_leader : existing.gap_to_leader
            }
        };
    }, {})) : dRes.data;

    // Pre-compute session-wide maximums to avoid recalculating inside the loop
    const compoundMaxLaps: Record<string, number> = {};
    if (sRes?.data) {
        sRes.data.forEach((s: { compound: string; lap_end: any; lap_start: number; }) => {
            const comp = s.compound || 'UNKNOWN';
            const sLen = (s.lap_end || 999) - s.lap_start + 1;
            if (!compoundMaxLaps[comp] || sLen > compoundMaxLaps[comp]) {
                compoundMaxLaps[comp] = sLen;
            }
        });
    }

    const driverMaxSpeeds: Record<string, number> = {};
    if (lRes?.data) {
        lRes.data.forEach((l: { st_speed: number; driver_number: string | number; }) => {
            const speed = l.st_speed || 0;
            if (speed > (driverMaxSpeeds[l.driver_number] || 0)) {
                driverMaxSpeeds[l.driver_number] = speed;
            }
        });
    }
    const sessionSpeedsArray = Object.values(driverMaxSpeeds).sort((a, b) => b - a);
    const benchmarkSpeed = sessionSpeedsArray[0] || 0;

    const positionStandings = driverList.map((row: any) => {
        const dNum = Number(row.driver_number);
        const driverInfo = dRes.data.find((d: any) => Number(d.driver_number) === dNum) || {};
        const pos = latestPositions[dNum]?.position || initialPositions[dNum]?.position || 99;
        
        // Extract short acronym (e.g. "VER", "RUS")
        const nameAcronym = driverInfo.name_acronym || (driverInfo.name ? driverInfo.name.split(' ').pop().substring(0, 3).toUpperCase() : 'UNK');
        
        // Clean up interval string
        let intervalStr = row.interval ? String(row.interval) : (row.gap_to_leader ? String(row.gap_to_leader) : '0.000');
        if (!intervalStr.endsWith('s') && !intervalStr.includes('LAP')) intervalStr += 's';
        if (!intervalStr.startsWith('+') && intervalStr !== '0.000s' && !intervalStr.includes('LAP')) intervalStr = '+' + intervalStr;

        return { dNum, pos, name: nameAcronym, interval: intervalStr };
    }).sort((a: any, b: any) => a.pos - b.pos);
    
    let results = driverList.map((row: any) => {
        const dNum = Number(row.driver_number);
        const driver = dRes.data.find((d: any) => Number(d.driver_number) === dNum) || {};
        
        const dLapsAll = lRes.data.filter((l: any) => Number(l.driver_number) === dNum);
        const dLapsCompleted = dLapsAll.filter((l: any) => typeof l.lap_duration === 'number' && l.lap_duration > 0);
        
        const dPits = pRes.data.filter((p: any) => Number(p.driver_number) === dNum);
        const dStints = sRes.data.filter((s: any) => Number(s.driver_number) === dNum).sort((a: any, b: any) => a.lap_start - b.lap_start);
        
        const bestLapData = dLapsCompleted.length > 0 ? dLapsCompleted.reduce((prev: any, current: any) => (prev.lap_duration < current.lap_duration) ? prev : current) : null;
        const bestLap = bestLapData ? bestLapData.lap_duration : Infinity;
        
        const lastLapData = dLapsAll.length > 0 ? dLapsAll[dLapsAll.length - 1] : null;
        const driverMaxLapCompleted = dLapsCompleted.length > 0 ? Math.max(...dLapsCompleted.map((l: any) => l.lap_number)) : 0;
        const driverMaxLapStarted = dLapsAll.length > 0 ? Math.max(...dLapsAll.map((l: any) => l.lap_number)) : 0;

        const stints = dStints.map((s: any, idx: number, arr: any[]) => {
            const startLap = s.lap_start;
            let endLap = s.lap_end;
            
            if (arr[idx + 1] && arr[idx + 1].lap_start > startLap) {
                endLap = arr[idx + 1].lap_start - 1;
            } else if (!endLap || endLap === 0 || endLap > maxRaceLap) {
                endLap = driverMaxLapStarted;
            }

            return {
                compound: s.compound || 'UNKNOWN',
                start: startLap,
                end: endLap,
                length: Math.max(endLap - startLap + 1, 1),
                tyre_age_at_start: s.tyre_age_at_start || 0
            };
        });

        const officialPosition = latestPositions[dNum]?.position || 99;
        const startingPosition = initialPositions[dNum]?.position || officialPosition;
        const posChange = startingPosition - officialPosition;

        const totalSeconds = dLapsCompleted.reduce((sum: number, lap: any) => sum + lap.lap_duration, 0);
        let carTotalTime = '-';
        if (isRace && dLapsCompleted.length > 0) {
            const h = Math.floor(totalSeconds / 3600);
            const m = Math.floor((totalSeconds % 3600) / 60);
            const s = (totalSeconds % 60).toFixed(3);
            carTotalTime = h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.padStart(6, '0')}` : `${m}:${s.padStart(6, '0')}`;
        }

        let status = 'Active';
        const gapUp = String(row.gap_to_leader || '').toUpperCase();
        const intUp = String(row.interval || '').toUpperCase();
        const isExplicitlyOut = gapUp.includes('DNF') || gapUp.includes('OUT') || gapUp.includes('RETIRED') || 
                                intUp.includes('DNF') || intUp.includes('OUT') || intUp.includes('RETIRED');

        if (isRace) {
            if (isExplicitlyOut) {
                status = 'DNF';
            } else if (driverMaxLapCompleted === 0 && maxRaceLap > 1) {
                status = 'DNS';
            } else if (maxRaceLap > 5 && (maxRaceLap - driverMaxLapCompleted) > 4) {
                status = 'DNF';
            }
        } else {
            if (isExplicitlyOut) status = 'DNF';
        }

        // 1. Stint Analytics
        const activeStintInfo = dStints.length > 0 ? dStints[dStints.length - 1] : null;
        const currentCompound = activeStintInfo?.compound || 'UNKNOWN';
        const stintStartLap = activeStintInfo?.lap_start || 1;
        const currentStintLength = Math.max(0, driverMaxLapStarted - stintStartLap + 1);
        const currentTyreAge = currentStintLength + (activeStintInfo?.tyre_age_at_start || 0);
        
        // Estimate tyre cliff (fallback to baselines if session data is sparse)
        let maxLapsOnCompound = compoundMaxLaps[currentCompound] || 0;
        if (maxLapsOnCompound < 5) maxLapsOnCompound = currentCompound === 'SOFT' ? 20 : currentCompound === 'MEDIUM' ? 30 : 40;

        // 2. Pace Drop-off (Degradation)
        const currentStintLaps = dLapsCompleted.filter((l: { lap_number: number; }) => l.lap_number >= stintStartLap);
        let paceDropOff = 0;
        if (currentStintLaps.length > 2) {
            const firstRepLap = currentStintLaps[1].lap_duration; // Compare from lap 2 to avoid out-lap anomalies
            const latestLap = currentStintLaps[currentStintLaps.length - 1].lap_duration;
            paceDropOff = (latestLap - firstRepLap) / (currentStintLaps.length - 2);
        }

        // 3. Speed Trap Ranking
        const driverSpeed = driverMaxSpeeds[dNum] || 0;
        const speedRank = sessionSpeedsArray.indexOf(driverSpeed) + 1;
        const speedDeficit = benchmarkSpeed - driverSpeed;

        // 4. Consistency Score
        const last5Laps = dLapsCompleted.slice(-5).map((l: { lap_duration: any; }) => l.lap_duration);
        let stdDev = 0;
        if (last5Laps.length > 1) {
            const mean = last5Laps.reduce((a: any, b: any) => a + b, 0) / last5Laps.length;
            const variance = last5Laps.reduce((a: number, b: number) => a + Math.pow(b - mean, 2), 0) / last5Laps.length;
            stdDev = Math.sqrt(variance);
        }

        const currentChampionStanding = getDriverStandings(dNum);

        const tyreHistory = buildTyreHistory(dStints, dPits, maxRaceLap);

        const analytics = {
            currentCompound,
            currentStintLength,
            currentTyreAge,
            maxLapsOnCompound,
            paceDropOff: paceDropOff || 0,
            driverSpeed,
            speedRank: speedRank > 0 ? speedRank : '-',
            speedDeficit: Math.max(0, speedDeficit),
            consistencyStdDev: stdDev || 0,
        };

        const myRankIdx = positionStandings.findIndex((p: { dNum: number; }) => p.dNum === dNum);
        const targetDriver = myRankIdx > 0 ? positionStandings[myRankIdx - 1] : null;
        const threatDriver = myRankIdx !== -1 && myRankIdx < positionStandings.length - 1 ? positionStandings[myRankIdx + 1] : null;
        const liveBattle = { target: targetDriver, threat: threatDriver };

        // --- LATEST PIT STOP (With Fallback Inference) ---
        let latestPit = null;
        if (dPits && dPits.length > 0) {
            const p = dPits[dPits.length - 1];
            latestPit = { 
                lap: p.lap, 
                stop_duration: p.stop_duration, 
                lane_duration: p.lane_duration, 
                pit_duration: p.pit_duration, 
                is_inferred: false 
            };
        } else if (dStints && dStints.length > 1) {
            const lastStint = dStints[dStints.length - 1];
            latestPit = { 
                lap: lastStint.start || lastStint.lap_start, 
                stop_duration: null, 
                lane_duration: null, 
                pit_duration: null, 
                is_inferred: true 
            };
        }

        return {
            driver_number: dNum,
            name: driver.full_name || driver.name_acronym || `Unknown (${dNum})`,
            team_color: driver.team_colour || 'ffffff',
            total_time: carTotalTime,
            interval: isRace ? (officialPosition === 1 ? '-' : formatGap(row.interval)) : '-',
            gap_to_leader: isRace ? (officialPosition === 1 ? '-' : formatGap(row.gap_to_leader)) : '-',
            pit_stops: dPits.map((p: any) => ({ 
                lap: p.lap_number, 
                pit_duration: p.pit_duration,
                lane_duration: p.lane_duration || p.pit_duration, 
                stop_duration: p.stop_duration || null
            })),
            best_lap_raw: bestLap,
            best_lap: formatLapTime(bestLap),
            best_sectors: bestLapData ? {
                s1: bestLapData.duration_sector_1, s2: bestLapData.duration_sector_2, s3: bestLapData.duration_sector_3,
                i1_speed: bestLapData.i1_speed, i2_speed: bestLapData.i2_speed, st_speed: bestLapData.st_speed,
                seg1: bestLapData.segments_sector_1 || [], seg2: bestLapData.segments_sector_2 || [], seg3: bestLapData.segments_sector_3 || []
            } : null,
            last_lap: lastLapData ? formatLapTime(lastLapData.lap_duration) : '-',
            last_sectors: lastLapData ? { 
                s1: lastLapData.duration_sector_1, s2: lastLapData.duration_sector_2, s3: lastLapData.duration_sector_3,
                i1_speed: lastLapData.i1_speed, i2_speed: lastLapData.i2_speed, st_speed: lastLapData.st_speed,
                seg1: lastLapData.segments_sector_1 || [], seg2: lastLapData.segments_sector_2 || [], seg3: lastLapData.segments_sector_3 || []
            } : null,
            stints, total_laps: maxRaceLap, official_position: officialPosition, pos_change: posChange, status,
            driver_laps: driverMaxLapCompleted,
            analytics,
            liveBattle,
            latestPit,
            championship: currentChampionStanding,
            tyreHistory
        };
    });

    if (isRace) {
        results.sort((a: any, b: any) => a.official_position - b.official_position);
        results = results.map((r: any, idx: number) => {
            const position = r.official_position !== 99 ? r.official_position : idx + 1;
            
            let currentGap = r.gap_to_leader;
            let currentInt = r.interval;
            
            if (position === 1) {
                currentGap = '-';
                currentInt = '-';
            } else {
                const prevCar = results[idx - 1];
                
                if (currentGap === '-' && currentInt !== '-' && !currentInt.includes('LAP') && prevCar && prevCar.gap_to_leader !== '-' && !prevCar.gap_to_leader.includes('LAP')) {
                    const prevGapNum = parseFloat(prevCar.gap_to_leader.replace('+', '').replace('s', ''));
                    const intNum = parseFloat(currentInt.replace('+', '').replace('s', ''));
                    if (!isNaN(prevGapNum) && !isNaN(intNum)) currentGap = `+${(prevGapNum + intNum).toFixed(3)}s`;
                }
                
                if (currentInt === '-' && currentGap !== '-' && !currentGap.includes('LAP') && prevCar && prevCar.gap_to_leader !== '-' && !prevCar.gap_to_leader.includes('LAP')) {
                    const prevGapNum = parseFloat(prevCar.gap_to_leader.replace('+', '').replace('s', ''));
                    const gapNum = parseFloat(currentGap.replace('+', '').replace('s', ''));
                    if (!isNaN(prevGapNum) && !isNaN(gapNum)) currentInt = `+${(Math.max(0, gapNum - prevGapNum)).toFixed(3)}s`;
                }
                
                if (prevCar && prevCar.gap_to_leader.includes('LAP') && currentGap === '-') {
                    currentGap = prevCar.gap_to_leader;
                }
            }
            
            return { 
                ...r, 
                position,
                interval: currentInt,
                gap_to_leader: currentGap
            };
        });
    } else {
        results.sort((a: any, b: any) => a.best_lap_raw - b.best_lap_raw);
        const p1Time = results[0]?.best_lap_raw;
        results = results.map((r: any, idx: number) => {
            r.position = idx + 1;
            if (idx === 0 && r.best_lap_raw !== Infinity) { r.interval = 'Leader'; r.gap_to_leader = 'Leader'; }
            else if (r.best_lap_raw !== Infinity) {
                r.gap_to_leader = `+${(r.best_lap_raw - p1Time).toFixed(3)}s`;
                r.interval = `+${(r.best_lap_raw - results[idx-1].best_lap_raw).toFixed(3)}s`;
            } else { r.gap_to_leader = 'No Time'; r.interval = '-'; }
            return r;
        });
    }
    
    return { weather, sessionBests: formattedBests, isRace, maxRaceLap, availableSessions, sessionName, results };
};

export const getRaceControl = async (sessionKey: string) => {
    const ttl = sessionKey === 'latest' ? 5000 : 86400000;
    const res = await getCached(`race_control_${sessionKey}`, ttl, () => openF1Request(`${OPENF1_BASE}/race_control?session_key=${sessionKey}`));
    return (res?.data || []).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
};

export const getCleanTelemetry = async (sessionKey: string, driverNumber: number, sinceTimestamp?: string) => {
    const ttl = sessionKey === 'latest' ? 1000 : 86400000;
    const timeFilter = sinceTimestamp ? `&date>=${sinceTimestamp}` : '';
    
    const laps = await getCached(`laps_${sessionKey}_${driverNumber}`, ttl, () => openF1Request(`${OPENF1_BASE}/laps?session_key=${sessionKey}&driver_number=${driverNumber}`));
    const carData = await getCached(`car_${sessionKey}_${driverNumber}${timeFilter}`, ttl, () => openF1Request(`${OPENF1_BASE}/car_data?session_key=${sessionKey}&driver_number=${driverNumber}${timeFilter}`));
    const stints = await getCached(`stints_${sessionKey}_${driverNumber}`, ttl, () => openF1Request(`${OPENF1_BASE}/stints?session_key=${sessionKey}&driver_number=${driverNumber}`));
    
    return {
        telemetry: processTelemetry(carData?.data || [], laps?.data || []),
        laps: laps?.data || [],
        stints: stints?.data || []
    };
};