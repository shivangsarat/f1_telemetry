type QualifyingClockArgs = {
    sessionName?: string | null;
    sessionType?: string | null;
    raceControl?: any[];
    nowMs: number;
};

export type QualifyingPhaseClock = {
    phase: number;
    label: string;
    remainingMs: number;
    isPaused: boolean;
};

const parsePhase = (value: any) => {
    const phase = Number(value);
    return Number.isFinite(phase) && phase >= 1 && phase <= 3 ? phase : null;
};

const eventTime = (event: any) => {
    const time = event?.date ? new Date(event.date).getTime() : NaN;
    return Number.isFinite(time) ? time : NaN;
};

const isPauseEvent = (event: any) => {
    const category = String(event?.category || '').toUpperCase();
    const flag = String(event?.flag || '').toUpperCase();
    const message = String(event?.message || event?.text || '').toUpperCase();

    return (
        /SUSPEND|STOPPED|STOPPING|ABORT/.test(message)
        || flag === 'RED'
        || flag === 'RED FLAG'
        || (category === 'SESSIONSTATUS' && /INACTIVE|SUSPEND/.test(message))
    );
};

const isResumeEvent = (event: any) => {
    const category = String(event?.category || '').toUpperCase();
    const flag = String(event?.flag || '').toUpperCase();
    const message = String(event?.message || event?.text || '').toUpperCase();

    return (
        /RESUM|RESTART|STARTED|STARTING/.test(message)
        || flag === 'GREEN'
        || (category === 'SESSIONSTATUS' && /ACTIVE|START/.test(message))
    );
};

const isExplicitPhaseStart = (event: any) => {
    const category = String(event?.category || '').toUpperCase();
    const message = String(event?.message || event?.text || '').toUpperCase();

    return (
        category === 'SESSIONSTATUS'
        && /START|ACTIVE|RESUM/.test(message)
    );
};

export const getQualifyingPhaseClock = ({
    sessionName,
    sessionType,
    raceControl = [],
    nowMs
}: QualifyingClockArgs): QualifyingPhaseClock | null => {
    const name = `${sessionName || ''} ${sessionType || ''}`.toLowerCase();
    if (!name.includes('qualifying')) return null;

    const events = raceControl
        .map((event: any) => ({
            ...event,
            _phase: parsePhase(event?.qualifying_phase),
            _time: eventTime(event)
        }))
        .filter((event: any) =>
            event._phase !== null
            && Number.isFinite(event._time)
            && event._time <= nowMs
        )
        .sort((a: any, b: any) => a._time - b._time);

    if (events.length === 0) return null;

    const latest = events[events.length - 1];
    const phase = Number(latest._phase);
    const phaseEvents = events.filter((event: any) => Number(event._phase) === phase);
    if (phaseEvents.length === 0) return null;

    const explicitStart = phaseEvents.find((event: any) => isExplicitPhaseStart(event));
    const phaseStart = explicitStart?._time ?? phaseEvents[0]._time;
    if (!Number.isFinite(phaseStart)) return null;

    const isSprintQualifying = name.includes('sprint');
    const phaseDurationsSeconds = isSprintQualifying
        ? [12 * 60, 10 * 60, 8 * 60]
        : [18 * 60, 15 * 60, 12 * 60];
    const phaseDurationMs = phaseDurationsSeconds[phase - 1] * 1000;

    let pausedSince: number | null = null;
    let pausedMs = 0;

    for (const event of phaseEvents) {
        if (event._time < phaseStart) continue;

        if (pausedSince === null && isPauseEvent(event)) {
            pausedSince = event._time;
            continue;
        }

        if (pausedSince !== null && isResumeEvent(event)) {
            pausedMs += Math.max(0, event._time - pausedSince);
            pausedSince = null;
        }
    }

    if (pausedSince !== null) {
        pausedMs += Math.max(0, nowMs - pausedSince);
    }

    const elapsedMs = Math.max(0, nowMs - phaseStart - pausedMs);
    const remainingMs = Math.max(0, phaseDurationMs - elapsedMs);

    return {
        phase,
        label: `${isSprintQualifying ? 'SQ' : 'Q'}${phase}`,
        remainingMs,
        isPaused: pausedSince !== null
    };
};
