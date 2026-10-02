import axios from 'axios';
import { OPENF1_BASE, ERGAST_BASE } from '../config';
import { processTelemetry } from './telemetryProcessor';

const cache = new Map<string, { data: any, expires: number }>();
const pendingRequests = new Map<string, Promise<any>>();
let globalRequestQueue = Promise.resolve();

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const enqueueRequest = <T>(fetcher: () => Promise<T>): Promise<T> => {
    const execute = globalRequestQueue.then(async () => {
        await sleep(350); 
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
            cache.set(key, { data: res, expires: Date.now() + ttlMs });
            return res;
        } catch (e: any) {
            if (e.response?.status === 429) {
                console.warn(`Rate limit hit on ${key}, queuing retry...`);
                await sleep(1500); 
                try {
                    const retryRes = await enqueueRequest(fetcher);
                    cache.set(key, { data: retryRes, expires: Date.now() + ttlMs });
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
    if (gap === null || gap === undefined || gap === '') return 'Leader';
    if (typeof gap === 'string' && gap.toUpperCase().includes('LAP')) return gap;
    const num = Number(gap);
    return (isNaN(num) || num === 0) ? 'Leader' : `+${num.toFixed(3)}s`;
};

const formatLapTime = (seconds: number | null) => {
    if (!seconds || isNaN(seconds) || seconds === Infinity) return '-';
    const m = Math.floor(seconds / 60);
    const s = (seconds % 60).toFixed(3);
    return m > 0 ? `${m}:${s.padStart(6, '0')}` : `${s}s`;
};

export const getHomeData = async () => {
    const [driversRes, teamsRes, meetingsRes, sessionsRes, liveRes] = await Promise.all([
        getCached('drivers_std', 600000, () => axios.get(`${ERGAST_BASE}/current/driverStandings.json`)),
        getCached('teams_std', 600000, () => axios.get(`${ERGAST_BASE}/current/constructorStandings.json`)),
        getCached('meetings', 600000, () => axios.get(`${OPENF1_BASE}/meetings?year=${new Date().getFullYear()}`)),
        getCached('sessions_race', 600000, () => axios.get(`${OPENF1_BASE}/sessions?year=${new Date().getFullYear()}&session_name=Race`)),
        getCached('live_status', 30000, () => axios.get(`${OPENF1_BASE}/sessions?session_key=latest`))
    ]);

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
        const sInfoRes = await getCached(`session_info_${sessionKey}`, ttl, () => axios.get(`${OPENF1_BASE}/sessions?session_key=${sessionKey}`));
        const sessionInfo = sInfoRes.data[0] || {};
        sessionName = sessionInfo.session_name || 'Session';
        
        if (sessionInfo.meeting_key) {
            const meetingSessionsRes = await getCached(`meeting_sessions_${sessionInfo.meeting_key}`, ttl, () => axios.get(`${OPENF1_BASE}/sessions?meeting_key=${sessionInfo.meeting_key}`));
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

    const activeSessionInfoRes = await getCached(`session_info_${sessionKey}`, ttl, () => axios.get(`${OPENF1_BASE}/sessions?session_key=${sessionKey}`));
    const activeSessionInfo = activeSessionInfoRes.data[0] || {};
    const isRace = activeSessionInfo.session_type?.includes('Race') || activeSessionInfo.session_type?.includes('Sprint');
    sessionName = activeSessionInfo.session_name || sessionName;

    const wRes = await getCached(`weather_${sessionKey}`, ttl, () => axios.get(`${OPENF1_BASE}/weather?session_key=${sessionKey}`));
    const iRes = await getCached(`intervals_${sessionKey}`, ttl, () => axios.get(`${OPENF1_BASE}/intervals?session_key=${sessionKey}`));
    const posRes = await getCached(`positions_${sessionKey}`, ttl, () => axios.get(`${OPENF1_BASE}/position?session_key=${sessionKey}`));
    const dRes = await getCached(`drivers_${sessionKey}`, 86400000, () => axios.get(`${OPENF1_BASE}/drivers?session_key=${sessionKey}`));
    const pRes = await getCached(`pits_${sessionKey}`, ttl, () => axios.get(`${OPENF1_BASE}/pit_stops?session_key=${sessionKey}`));
    const lRes = await getCached(`laps_${sessionKey}`, ttl, () => axios.get(`${OPENF1_BASE}/laps?session_key=${sessionKey}`));
    const sRes = await getCached(`stints_${sessionKey}`, ttl, () => axios.get(`${OPENF1_BASE}/stints?session_key=${sessionKey}`));

    const weather = wRes.data[wRes.data.length - 1] || null;
    
    const lapsFromLaps = Math.max(...(lRes.data || []).map((l: any) => l.lap_number || 0), 0);
    const lapsFromStints = Math.max(...(sRes.data || []).map((s: any) => s.lap_end || s.lap_start || 0), 0);
    const maxRaceLap = Math.max(lapsFromLaps, lapsFromStints, 1);
    
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

    const driverList = isRace ? Object.values(iRes.data.reduce((acc: any, c: any) => ({ ...acc, [c.driver_number]: c }), {})) : dRes.data;
    
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

        const stints = dStints.map((s: any) => ({
            compound: s.compound || 'UNKNOWN',
            start: s.lap_start,
            end: s.lap_end || driverMaxLapStarted,
            length: Math.max((s.lap_end || driverMaxLapStarted) - s.lap_start, 1)
        }));

        const officialPosition = latestPositions[dNum]?.position || 99;
        const startingPosition = initialPositions[dNum]?.position || officialPosition;
        const posChange = startingPosition - officialPosition;

        let leaderTotalTime = '-';
        if (isRace && officialPosition === 1 && dLapsCompleted.length > 0) {
            const totalSeconds = dLapsCompleted.reduce((sum: number, lap: any) => sum + lap.lap_duration, 0);
            const h = Math.floor(totalSeconds / 3600);
            const m = Math.floor((totalSeconds % 3600) / 60);
            const s = (totalSeconds % 60).toFixed(3);
            leaderTotalTime = h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.padStart(6, '0')}` : `${m}:${s.padStart(6, '0')}`;
        }

        const isLapped = String(row.gap_to_leader).toUpperCase().includes('LAP') || String(row.interval).toUpperCase().includes('LAP');
        let status = 'Active';
        if (isRace) {
            if (driverMaxLapCompleted === 0 && maxRaceLap > 1) status = 'DNS';
            else if (maxRaceLap > 5 && (maxRaceLap - driverMaxLapCompleted) > 4 && !isLapped) status = 'DNF';
        }

        return {
            driver_number: dNum,
            name: driver.full_name || driver.name_acronym || `Unknown (${dNum})`,
            team_color: driver.team_colour || 'ffffff',
            interval: isRace ? (officialPosition === 1 ? leaderTotalTime : formatGap(row.interval)) : '-',
            gap_to_leader: isRace ? formatGap(row.gap_to_leader) : '-',
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
            driver_laps: driverMaxLapCompleted
        };
    });

    if (isRace) {
        results.sort((a: any, b: any) => a.official_position - b.official_position);
        results = results.map((r: any, idx: number) => ({ ...r, position: r.official_position !== 99 ? r.official_position : idx + 1 }));
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
    const res = await getCached(`race_control_${sessionKey}`, ttl, () => axios.get(`${OPENF1_BASE}/race_control?session_key=${sessionKey}`));
    return (res?.data || []).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
};

export const getCleanTelemetry = async (sessionKey: string, driverNumber: number, sinceTimestamp?: string) => {
    const ttl = sessionKey === 'latest' ? 1000 : 86400000;
    const timeFilter = sinceTimestamp ? `&date>=${sinceTimestamp}` : '';
    
    const laps = await getCached(`laps_${sessionKey}_${driverNumber}`, ttl, () => axios.get(`${OPENF1_BASE}/laps?session_key=${sessionKey}&driver_number=${driverNumber}`));
    const carData = await getCached(`car_${sessionKey}_${driverNumber}${timeFilter}`, ttl, () => axios.get(`${OPENF1_BASE}/car_data?session_key=${sessionKey}&driver_number=${driverNumber}${timeFilter}`));
    const stints = await getCached(`stints_${sessionKey}_${driverNumber}`, ttl, () => axios.get(`${OPENF1_BASE}/stints?session_key=${sessionKey}&driver_number=${driverNumber}`));
    
    return {
        telemetry: processTelemetry(carData?.data || [], laps?.data || []),
        laps: laps?.data || [],
        stints: stints?.data || []
    };
};