const parseF1Date = (dateStr: string) => {
    if (!dateStr) return NaN;
    const safeStr = dateStr.replace(/(\.\d{3})\d+/, '$1').replace('+00:00', 'Z');
    return new Date(safeStr).getTime();
};

export const processTelemetry = (carData: any[], lapsData: any[]) => {
    if (!carData || !lapsData || carData.length === 0 || lapsData.length === 0) return [];

    const validLaps = lapsData
        .filter(l => typeof l.lap_duration === 'number' && l.lap_duration > 0 && l.date_start)
        .map(l => ({
            lap: l.lap_number,
            start: parseF1Date(l.date_start),
            end: parseF1Date(l.date_start) + (l.lap_duration * 1000),
            duration: l.lap_duration
        }))
        .sort((a, b) => a.start - b.start);

    if (validLaps.length === 0) return [];

    const mappedData = carData.reduce((acc: any[], t: any) => {
        const tTime = parseF1Date(t.date);
        if (isNaN(tTime)) return acc;

        let left = 0, right = validLaps.length - 1, match = null;
        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const lap = validLaps[mid];
            if (tTime >= lap.start && tTime <= lap.end) { match = lap; break; }
            else if (tTime < lap.start) right = mid - 1;
            else left = mid + 1;
        }

        if (match) {
            acc.push({
                lapX: match.lap + ((tTime - match.start) / (match.duration * 1000)),
                speed: t.speed || 0,
                throttle: t.throttle || 0,
                brake: t.brake || 0,
                rpm: t.rpm || 0,
                gear: t.n_gear || 0
            });
        }
        return acc;
    }, []);

    mappedData.sort((a: any, b: any) => a.lapX - b.lapX);
    const cleanData = [];
    let lastX = -1;
    for (const point of mappedData) {
        if (point.lapX > lastX) {
            cleanData.push(point);
            lastX = point.lapX;
        }
    }
    return cleanData;
};