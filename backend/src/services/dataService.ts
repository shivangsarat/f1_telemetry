import axios from 'axios';
import { CONFIG, OPENF1_BASE, ERGAST_BASE } from '../config';
import { calculateRaceView, buildTelemetryHistory } from '../calculations/raceCalculations';

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

const F1_LIVETIMING_STATIC = 'https://livetiming.formula1.com/static';

const parseLapCountPayload = (payload: any): number | null => {
    const total = Number(payload?.TotalLaps ?? payload?.totalLaps ?? payload?.total_laps);
    return Number.isFinite(total) && total > 0 ? total : null;
};

const parseLapCountStream = (raw: any): number | null => {
    if (typeof raw !== 'string') return null;
    const lines = raw.split(/\r?\n/).filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index--) {
        const line = lines[index];
        const jsonStart = line.indexOf('{');
        if (jsonStart < 0) continue;
        try {
            const value = parseLapCountPayload(JSON.parse(line.slice(jsonStart)));
            if (value) return value;
        } catch {
            // Ignore malformed/partial stream lines and continue backwards.
        }
    }
    return null;
};

export const getScheduledTotalLaps = async (sessionInfo: any): Promise<number | null> => {
    const direct = Number(
        sessionInfo?.total_laps
        ?? sessionInfo?.totalLaps
        ?? sessionInfo?.number_of_laps
        ?? sessionInfo?.NumberOfLaps
    );
    if (Number.isFinite(direct) && direct > 0) return direct;

    const sessionType = String(sessionInfo?.session_type || sessionInfo?.session_name || '').toLowerCase();
    if (!sessionType.includes('race') && !sessionType.includes('sprint')) return null;

    const sessionKey = Number(sessionInfo?.session_key);
    const year = Number(sessionInfo?.year)
        || (sessionInfo?.date_start ? new Date(sessionInfo.date_start).getUTCFullYear() : NaN);
    if (!Number.isFinite(year)) return null;

    try {
        const seasonIndexRes = await getCached(
            `f1_livetiming_index_${year}`,
            600000,
            () => axios.get(`${F1_LIVETIMING_STATIC}/${year}/Index.json`, {
                headers: { 'User-Agent': 'F1-Dash/1.0' }
            })
        );

        const meetings = seasonIndexRes?.data?.Meetings || [];
        const sessions = meetings.flatMap((meeting: any) =>
            (meeting.Sessions || []).map((session: any) => ({ ...session, __meeting: meeting }))
        );

        let liveTimingSession = sessions.find((session: any) =>
            Number.isFinite(sessionKey) && Number(session.Key) === sessionKey
        );

        if (!liveTimingSession) {
            const targetStart = sessionInfo?.date_start ? new Date(sessionInfo.date_start).getTime() : NaN;
            const targetName = String(sessionInfo?.session_name || sessionInfo?.session_type || '').toLowerCase();
            liveTimingSession = sessions.find((session: any) => {
                const name = String(session.Name || session.Type || '').toLowerCase();
                const start = session.StartDate ? new Date(session.StartDate).getTime() : NaN;
                return name === targetName
                    && (!Number.isFinite(targetStart) || !Number.isFinite(start) || Math.abs(start - targetStart) < 6 * 60 * 60 * 1000);
            });
        }

        if (!liveTimingSession?.Path) return null;

        const path = String(liveTimingSession.Path).replace(/^\/+/, '');
        const sessionBase = liveTimingSession.Path.startsWith('http')
            ? String(liveTimingSession.Path).replace(/\/$/, '')
            : `${F1_LIVETIMING_STATIC}/${path.replace(/\/$/, '')}`;

        const sessionIndexRes = await getCached(
            `f1_livetiming_session_index_${year}_${sessionKey || path}`,
            600000,
            () => axios.get(`${sessionBase}/Index.json`, {
                headers: { 'User-Agent': 'F1-Dash/1.0' }
            })
        );

        const lapCountFeed = sessionIndexRes?.data?.Feeds?.LapCount || {};
        const keyFramePath = lapCountFeed.KeyFramePath || 'LapCount.json';

        try {
            const keyFrameRes = await getCached(
                `f1_lap_count_${year}_${sessionKey || path}`,
                30000,
                () => axios.get(`${sessionBase}/${keyFramePath}`, {
                    headers: { 'User-Agent': 'F1-Dash/1.0' }
                })
            );
            const total = parseLapCountPayload(keyFrameRes?.data);
            if (total) return total;
        } catch {
            // Some sessions expose only the stream while the keyframe is unavailable.
        }

        const streamPath = lapCountFeed.StreamPath;
        if (streamPath) {
            const streamRes = await axios.get(`${sessionBase}/${streamPath}`, {
                headers: { 'User-Agent': 'F1-Dash/1.0' },
                responseType: 'text'
            });
            return parseLapCountStream(streamRes.data);
        }
    } catch (error: any) {
        console.warn('⚠️ Unable to resolve scheduled race laps from F1 LiveTiming:', error?.message || error);
    }

    return null;
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

const isTestingSession = (meeting: any, session: any) => {
    const meetingName = String(meeting?.meeting_name || '').toLowerCase();
    const sessionName = String(session?.session_name || '').toLowerCase();
    const sessionType = String(session?.session_type || '').toLowerCase();
    return meetingName.includes('test') || sessionName.includes('test') || sessionType.includes('test');
};

const mapSeasonCalendarEntries = (meetings: any[] = [], sessions: any[] = [], year: number) => {
    const entries: any[] = [];

    for (const meeting of meetings) {
        const meetingSessions = sessions
            .filter((session: any) => session.meeting_key === meeting.meeting_key)
            .sort((a: any, b: any) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime());

        const testingSessions = meetingSessions.filter((session: any) => isTestingSession(meeting, session));
        if (testingSessions.length > 0) {
            const now = Date.now();
            const startedSessions = testingSessions.filter((session: any) =>
                new Date(session.date_start).getTime() <= now
            );
            const representativeSession = startedSessions.length > 0
                ? startedSessions[startedSessions.length - 1]
                : testingSessions[0];

            entries.push({
                round: meeting.meeting_name || 'Pre-Season Testing',
                location: meeting.location,
                date: testingSessions[0]?.date_start || meeting.date_start,
                date_end: testingSessions[testingSessions.length - 1]?.date_end || meeting.date_end,
                session_key: representativeSession?.session_key,
                meeting_key: meeting.meeting_key,
                year,
                is_testing: true,
                session_name: representativeSession?.session_name,
                session_count: testingSessions.length
            });
            continue;
        }

        const race = meetingSessions.find((session: any) =>
            String(session.session_name || '').toLowerCase() === 'race'
            || String(session.session_type || '').toLowerCase() === 'race'
        );

        if (race) {
            entries.push({
                round: meeting.meeting_name,
                location: meeting.location,
                date: race.date_start || meeting.date_start,
                session_key: race.session_key,
                meeting_key: meeting.meeting_key,
                year,
                is_testing: false,
                session_name: race.session_name
            });
        }
    }

    return entries;
};

const OPENF1_OLDEST_SEASON = 2023;

export const getAvailableSeasons = () => {
    const currentYear = new Date().getFullYear();
    const availableSeasons = Array.from(
        { length: Math.max(1, currentYear - OPENF1_OLDEST_SEASON + 1) },
        (_, index) => currentYear - index
    );

    return {
        currentSeason: currentYear,
        oldestSeason: OPENF1_OLDEST_SEASON,
        availableSeasons
    };
};

export const getSeasonRaces = async (year: number) => {
    const currentYear = new Date().getFullYear();
    if (!Number.isInteger(year) || year < 1900 || year > currentYear) {
        return [];
    }

    const [meetingsRes, sessionsRes] = await Promise.all([
        getCached(
            `meetings_${year}`,
            600000,
            () => openF1Request(`${OPENF1_BASE}/meetings?year=${year}`)
        ),
        getCached(
            `sessions_all_${year}`,
            600000,
            () => openF1Request(`${OPENF1_BASE}/sessions?year=${year}`)
        )
    ]);

    const now = Date.now();
    return mapSeasonCalendarEntries(meetingsRes?.data || [], sessionsRes?.data || [], year)
        .filter((race: any) => new Date(race.date).getTime() <= now)
        .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
};

export const getHomeData = async () => {
    const currentYear = new Date().getFullYear();

    const [liveRes, driversRes, teamsRes] = await Promise.all([
        getCached('live_status', 30000, () => openF1Request(`${OPENF1_BASE}/sessions?session_key=latest`)),
        getCached('drivers_std', 600000, () => axios.get(`${ERGAST_BASE}/current/driverStandings.json`)),
        getCached('teams_std', 600000, () => axios.get(`${ERGAST_BASE}/current/constructorStandings.json`))
    ]);

    let meetingsRes = await getCached(`meetings_${currentYear}`, 600000, () => openF1Request(`${OPENF1_BASE}/meetings?year=${currentYear}`));
    let sessionsRes = await getCached(`sessions_all_${currentYear}`, 600000, () => openF1Request(`${OPENF1_BASE}/sessions?year=${currentYear}`));

    if (!meetingsRes?.data || meetingsRes.data.length === 0) {
        console.warn(`No calendar data found for ${currentYear}. Falling back to 2024 calendar...`);
        meetingsRes = await getCached('meetings_2024', 600000, () => openF1Request(`${OPENF1_BASE}/meetings?year=2024`));
        sessionsRes = await getCached('sessions_all_2024', 600000, () => openF1Request(`${OPENF1_BASE}/sessions?year=2024`));
    }

    let nextYearMeetingsRes: any = { data: [] };
    let nextYearSessionsRes: any = { data: [] };
    try {
        [nextYearMeetingsRes, nextYearSessionsRes] = await Promise.all([
            getCached(`meetings_${currentYear + 1}`, 600000, () => openF1Request(`${OPENF1_BASE}/meetings?year=${currentYear + 1}`)),
            getCached(`sessions_all_${currentYear + 1}`, 600000, () => openF1Request(`${OPENF1_BASE}/sessions?year=${currentYear + 1}`))
        ]);
    } catch (error: any) {
        console.warn(`Next-year calendar for ${currentYear + 1} is not available yet:`, error?.message || error);
    }

    const driversData = driversRes?.data?.MRData?.StandingsTable?.StandingsLists[0]?.DriverStandings || [];
    const drivers = driversData.map((d: any, idx: number) => ({
        position: d.position,
        driver_id: d.Driver.driverId,
        permanent_number: d.Driver.permanentNumber,
        code: d.Driver.code,
        given_name: d.Driver.givenName,
        family_name: d.Driver.familyName,
        name: `${d.Driver.givenName} ${d.Driver.familyName}`,
        nationality: d.Driver.nationality,
        date_of_birth: d.Driver.dateOfBirth,
        team_id: d.Constructors[0]?.constructorId,
        team: d.Constructors[0]?.name,
        points: d.points,
        wins: d.wins,
        diff_to_next: idx === 0 ? '-' : `-${Number(driversData[idx-1].points) - Number(d.points)}`
    }));

    const teamsData = teamsRes?.data?.MRData?.StandingsTable?.StandingsLists[0]?.ConstructorStandings || [];
    const teams = teamsData.map((t: any, idx: number) => ({
        position: t.position,
        team_id: t.Constructor.constructorId,
        name: t.Constructor.name,
        nationality: t.Constructor.nationality,
        points: t.points,
        wins: t.wins,
        diff_to_next: idx === 0 ? '-' : `-${Number(teamsData[idx-1].points) - Number(t.points)}`
    }));

    const races = mapSeasonCalendarEntries(meetingsRes?.data || [], sessionsRes?.data || [], currentYear);
    const nextYearRaces = mapSeasonCalendarEntries(nextYearMeetingsRes?.data || [], nextYearSessionsRes?.data || [], currentYear + 1)
        .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const now = Date.now();
    const pastRaces = races.filter((r: any) => new Date(r.date).getTime() <= now).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const upcomingRaces = [
        ...races.filter((r: any) => new Date(r.date).getTime() > now),
        ...nextYearRaces
    ].sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let liveStatus = { isLive: false, session_key: null, type: '' };
    if (liveRes?.data?.[0]) {
        const s = liveRes.data[0];
        const end = new Date(s.date_end).getTime();
        liveStatus = { isLive: now >= new Date(s.date_start).getTime() && (isNaN(end) || now <= end), session_key: s.session_key, type: s.session_name };
    }

    const seasonMeta = getAvailableSeasons();

    return { drivers, teams, pastRaces, upcomingRaces, nextYearRaces, liveStatus, seasonMeta };
};

export const getDriverSeasonProfile = async (driverId: string) => {
    const safeId = encodeURIComponent(driverId);
    const [standingsRes, resultsRes] = await Promise.all([
        getCached(
            `driver_profile_standings_${safeId}`,
            300000,
            () => axios.get(`${ERGAST_BASE}/current/drivers/${safeId}/driverStandings.json`)
        ),
        getCached(
            `driver_profile_results_${safeId}`,
            300000,
            () => axios.get(`${ERGAST_BASE}/current/drivers/${safeId}/results.json`)
        )
    ]);

    const standings = standingsRes?.data?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings?.[0] || null;
    const races = resultsRes?.data?.MRData?.RaceTable?.Races || [];
    const driver = standings?.Driver || races?.[0]?.Results?.[0]?.Driver || null;
    const constructor = standings?.Constructors?.[0] || races?.[0]?.Results?.[0]?.Constructor || null;

    return {
        season: Number(standingsRes?.data?.MRData?.StandingsTable?.season || new Date().getFullYear()),
        driver: driver ? {
            id: driver.driverId,
            permanent_number: driver.permanentNumber,
            code: driver.code,
            given_name: driver.givenName,
            family_name: driver.familyName,
            name: `${driver.givenName || ''} ${driver.familyName || ''}`.trim(),
            nationality: driver.nationality,
            date_of_birth: driver.dateOfBirth
        } : null,
        team: constructor ? {
            id: constructor.constructorId,
            name: constructor.name,
            nationality: constructor.nationality
        } : null,
        standing: standings ? {
            position: Number(standings.position),
            points: Number(standings.points),
            wins: Number(standings.wins)
        } : null,
        races: races.map((race: any) => {
            const result = race.Results?.[0] || {};
            return {
                round: Number(race.round),
                race_name: race.raceName,
                date: race.date,
                position: result.position,
                grid: result.grid,
                points: Number(result.points || 0),
                status: result.status,
                laps: Number(result.laps || 0),
                fastest_lap_rank: result.FastestLap?.rank || null,
                fastest_lap_time: result.FastestLap?.Time?.time || null
            };
        })
    };
};

export const getTeamSeasonProfile = async (constructorId: string) => {
    const safeId = encodeURIComponent(constructorId);
    const [standingsRes, resultsRes, driversRes] = await Promise.all([
        getCached(
            `team_profile_standings_${safeId}`,
            300000,
            () => axios.get(`${ERGAST_BASE}/current/constructors/${safeId}/constructorStandings.json`)
        ),
        getCached(
            `team_profile_results_${safeId}`,
            300000,
            () => axios.get(`${ERGAST_BASE}/current/constructors/${safeId}/results.json`)
        ),
        getCached(
            `team_profile_drivers_${safeId}`,
            300000,
            () => axios.get(`${ERGAST_BASE}/current/constructors/${safeId}/drivers.json`)
        )
    ]);

    const standing = standingsRes?.data?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings?.[0] || null;
    const constructor = standing?.Constructor || null;
    const races = resultsRes?.data?.MRData?.RaceTable?.Races || [];
    const drivers = driversRes?.data?.MRData?.DriverTable?.Drivers || [];

    return {
        season: Number(standingsRes?.data?.MRData?.StandingsTable?.season || new Date().getFullYear()),
        team: constructor ? {
            id: constructor.constructorId,
            name: constructor.name,
            nationality: constructor.nationality
        } : null,
        standing: standing ? {
            position: Number(standing.position),
            points: Number(standing.points),
            wins: Number(standing.wins)
        } : null,
        drivers: drivers.map((driver: any) => ({
            id: driver.driverId,
            permanent_number: driver.permanentNumber,
            code: driver.code,
            name: `${driver.givenName || ''} ${driver.familyName || ''}`.trim(),
            nationality: driver.nationality
        })),
        races: races.map((race: any) => ({
            round: Number(race.round),
            race_name: race.raceName,
            date: race.date,
            results: (race.Results || []).map((result: any) => ({
                driver_id: result.Driver?.driverId,
                driver_name: `${result.Driver?.givenName || ''} ${result.Driver?.familyName || ''}`.trim(),
                position: result.position,
                grid: result.grid,
                points: Number(result.points || 0),
                status: result.status,
                laps: Number(result.laps || 0)
            }))
        }))
    };
};

export const getCurrentLiveSession = async () => {
    const now = Date.now();
    const currentYear = new Date(now).getUTCFullYear();

    const sessionsRes = await getCached(
        `current_live_sessions_${currentYear}`,
        15000,
        () => openF1Request(`${OPENF1_BASE}/sessions?year=${currentYear}`)
    );

    const sessions = (sessionsRes?.data || [])
        .filter((session: any) => {
            const start = new Date(session.date_start || 0).getTime();
            const end = new Date(session.date_end || 0).getTime();

            if (!Number.isFinite(start) || start > now) return false;

            // Most OpenF1 sessions expose date_end. If it is temporarily absent,
            // keep a recently-started session eligible for a bounded window.
            if (Number.isFinite(end) && end > 0) return now <= end;
            return now - start <= 12 * 60 * 60 * 1000;
        })
        .sort((a: any, b: any) =>
            new Date(b.date_start || 0).getTime() - new Date(a.date_start || 0).getTime()
        );

    return sessions[0] || null;
};

export const getRaceDetails = async (sessionKey: string, liveOverride = false) => {
    const ttl = sessionKey === 'latest' || liveOverride ? 5000 : 86400000;
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

    let meetingInfo: any = null;
    let circuitInfo: any = null;
    if (sessionInfo.meeting_key) {
        const meetingInfoRes = await getCached(
            `meeting_info_${sessionInfo.meeting_key}`,
            600000,
            () => openF1Request(`${OPENF1_BASE}/meetings?meeting_key=${sessionInfo.meeting_key}`)
        );
        meetingInfo = meetingInfoRes.data?.[0] || null;

        if (meetingInfo?.circuit_info_url) {
            const circuitInfoRes = await getCached(
                `circuit_info_${meetingInfo.circuit_key}_${meetingInfo.year || sessionInfo.year || ''}`,
                86400000,
                () => axios.get(meetingInfo.circuit_info_url, { headers: { 'User-Agent': 'FastF1/' } })
            );
            circuitInfo = circuitInfoRes?.data || null;
        }
    }

    const isUpcoming = Boolean(
        sessionInfo?.date_start
        && new Date(sessionInfo.date_start).getTime() > Date.now()
    );

    if (isUpcoming) {
        return {
            active_session_key: undefined,
            isUpcoming: true,
            isRace,
            sessionInfo,
            meetingInfo,
            circuitInfo,
            availableSessions,
            results: [],
            raceControl: [],
            weather: null,
            sessionBests: null,
            maxRaceLap: 0,
            scheduledTotalLaps: null
        };
    }

    const scheduledTotalLaps = isRace
        ? await getScheduledTotalLaps(sessionInfo)
        : null;

    const sessionYear = Number(sessionInfo.year)
        || (sessionInfo.date_start ? new Date(sessionInfo.date_start).getUTCFullYear() : new Date().getUTCFullYear());
    const seasonSessionsRes = await getCached(
        `season_sessions_${sessionYear}`,
        600000,
        () => openF1Request(`${OPENF1_BASE}/sessions?year=${sessionYear}`)
    );
    const sessionStartTime = new Date(sessionInfo.date_start || 0).getTime();
    const futurePointSessions = (seasonSessionsRes.data || []).filter((session: any) => {
        if (String(session.session_key) === String(activeSessionKey)) return false;
        const name = String(session.session_name || session.session_type || '').toLowerCase();
        return new Date(session.date_start || 0).getTime() > sessionStartTime
            && (name === 'race' || name === 'sprint');
    });
    const raceWinPoints = sessionYear <= 2024 ? 26 : 25;
    const remainingChampionshipPoints = futurePointSessions.reduce((total: number, session: any) => {
        const name = String(session.session_name || session.session_type || '').toLowerCase();
        return total + (name === 'sprint' ? 8 : raceWinPoints);
    }, 0);

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
            meetingInfo,
            circuitInfo,
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
            remainingChampionshipPoints,
            scheduledTotalLaps,
            isRace
        })
    };
};

export const getRaceControl = async (sessionKey: string) => {
    const ttl = sessionKey === 'latest' ? 5000 : 86400000;
    const res = await getCached(`race_control_${sessionKey}`, ttl, () => openF1Request(`${OPENF1_BASE}/race_control?session_key=${sessionKey}`));
    return (res?.data || []).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
};

export const getCleanTelemetry = async (
    sessionKey: string,
    driverNumber: number,
    sinceTimestamp?: string,
    live = false
) => {
    const ttl = live || sessionKey === 'latest' ? 1000 : 86400000;
    const timeFilter = sinceTimestamp ? `&date>=${sinceTimestamp}` : '';
    
    const [laps, carData, stints, locations] = await Promise.all([
        getCached(`laps_${sessionKey}_${driverNumber}`, ttl, () => openF1Request(`${OPENF1_BASE}/laps?session_key=${sessionKey}&driver_number=${driverNumber}`)),
        getCached(`car_${sessionKey}_${driverNumber}${timeFilter}`, ttl, () => openF1Request(`${OPENF1_BASE}/car_data?session_key=${sessionKey}&driver_number=${driverNumber}${timeFilter}`)),
        getCached(`stints_${sessionKey}_${driverNumber}`, ttl, () => openF1Request(`${OPENF1_BASE}/stints?session_key=${sessionKey}&driver_number=${driverNumber}`)),
        getCached(`location_${sessionKey}_${driverNumber}${timeFilter}`, ttl, () => openF1Request(`${OPENF1_BASE}/location?session_key=${sessionKey}&driver_number=${driverNumber}${timeFilter}`))
    ]);
    
    return {
        telemetry: buildTelemetryHistory(carData?.data || [], laps?.data || [], locations?.data || []),
        laps: laps?.data || [],
        stints: stints?.data || [],
        locations: locations?.data || []
    };
};