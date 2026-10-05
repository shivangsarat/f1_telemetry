import axios from 'axios';
import { CONFIG, OPENF1_BASE, ERGAST_BASE } from '../config';
import { processTelemetry } from './telemetryProcessor';
import { calculateRaceView } from '../calculations/raceCalculations';

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
    let activeSessionKey = sessionKey;
    let availableSessions: any[] = [];

    if (sessionKey !== 'latest') {
        const sessionInfoRes = await getCached(
            `session_info_${sessionKey}`,
            ttl,
            () => openF1Request(`${OPENF1_BASE}/sessions?session_key=${sessionKey}`)
        );
        const requestedSession = sessionInfoRes.data?.[0] || {};

        if (requestedSession.meeting_key) {
            const meetingSessionsRes = await getCached(
                `meeting_sessions_${requestedSession.meeting_key}`,
                ttl,
                () => openF1Request(`${OPENF1_BASE}/sessions?meeting_key=${requestedSession.meeting_key}`)
            );

            availableSessions = (meetingSessionsRes.data || [])
                .sort((a: any, b: any) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime());

            if (new Date(requestedSession.date_start).getTime() > Date.now()) {
                const past = availableSessions.filter((item: any) => new Date(item.date_start).getTime() <= Date.now());
                if (past.length) activeSessionKey = String(past[past.length - 1].session_key);
            }
        }
    }

    const sessionInfoRes = await getCached(
        `session_info_${activeSessionKey}`,
        ttl,
        () => openF1Request(`${OPENF1_BASE}/sessions?session_key=${activeSessionKey}`)
    );
    const sessionInfo = sessionInfoRes.data?.[0] || {};
    const isRace = String(sessionInfo.session_type || sessionInfo.session_name || '').toLowerCase().includes('race')
        || String(sessionInfo.session_type || '').toLowerCase().includes('sprint');

    if (!availableSessions.length && sessionInfo.meeting_key) {
        const meetingSessionsRes = await getCached(
            `meeting_sessions_${sessionInfo.meeting_key}`,
            ttl,
            () => openF1Request(`${OPENF1_BASE}/sessions?meeting_key=${sessionInfo.meeting_key}`)
        );
        availableSessions = (meetingSessionsRes.data || [])
            .sort((a: any, b: any) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime());
    }

    const [
        weatherRes,
        intervalsRes,
        positionsRes,
        driversRes,
        pitsRes,
        lapsRes,
        stintsRes,
        championshipDriversRes,
        championshipTeamsRes,
        raceControlRes
    ] = await Promise.all([
        getCached(`weather_${activeSessionKey}`, ttl, () => openF1Request(`${OPENF1_BASE}/weather?session_key=${activeSessionKey}`)),
        getCached(`intervals_${activeSessionKey}`, ttl, () => openF1Request(`${OPENF1_BASE}/intervals?session_key=${activeSessionKey}`)),
        getCached(`positions_${activeSessionKey}`, ttl, () => openF1Request(`${OPENF1_BASE}/position?session_key=${activeSessionKey}`)),
        getCached(`drivers_${activeSessionKey}`, 86400000, () => openF1Request(`${OPENF1_BASE}/drivers?session_key=${activeSessionKey}`)),
        getCached(`pits_${activeSessionKey}`, ttl, () => openF1Request(`${OPENF1_BASE}/pit?session_key=${activeSessionKey}`)),
        getCached(`laps_${activeSessionKey}`, ttl, () => openF1Request(`${OPENF1_BASE}/laps?session_key=${activeSessionKey}`)),
        getCached(`stints_${activeSessionKey}`, ttl, () => openF1Request(`${OPENF1_BASE}/stints?session_key=${activeSessionKey}`)),
        getCached(`championship_drivers_${activeSessionKey}`, ttl, () => openF1Request(`${OPENF1_BASE}/championship_drivers?session_key=${activeSessionKey}`)),
        getCached(`championship_teams_${activeSessionKey}`, ttl, () => openF1Request(`${OPENF1_BASE}/championship_teams?session_key=${activeSessionKey}`)),
        getCached(`race_control_${activeSessionKey}`, ttl, () => openF1Request(`${OPENF1_BASE}/race_control?session_key=${activeSessionKey}`))
    ]);

    return {
        active_session_key: activeSessionKey !== sessionKey ? activeSessionKey : undefined,
        ...calculateRaceView({
            sessionInfo,
            availableSessions,
            drivers: driversRes.data || [],
            intervals: intervalsRes.data || [],
            positions: positionsRes.data || [],
            laps: lapsRes.data || [],
            stints: stintsRes.data || [],
            pits: pitsRes.data || [],
            weather: weatherRes.data?.[weatherRes.data.length - 1] || null,
            raceControl: raceControlRes.data || [],
            championshipDrivers: championshipDriversRes.data || [],
            championshipTeams: championshipTeamsRes.data || [],
            isRace
        })
    };
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