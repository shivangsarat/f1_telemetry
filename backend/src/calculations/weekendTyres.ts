export type TyreRun = {
    session: string; sessionKey: number; start: number; stint: number;
    compound: string; startAge: number | null; laps: number;
};
export const reconstructTyres = (runs: TyreRun[], sprint = false) => {
    const allocation: Record<string, number> = { HARD: 2, MEDIUM: sprint ? 4 : 3, SOFT: sprint ? 6 : 8 };
    const prefix: Record<string, string> = { HARD: 'H', MEDIUM: 'M', SOFT: 'S', INTERMEDIATE: 'I', WET: 'W' };
    const sets: any[] = [];
    Object.entries(allocation).forEach(([compound, count]) => {
        for (let i = 1; i <= count; i++) sets.push({ id: `${prefix[compound]}${i}`, compound, age: null, lastUsed: null, history: [], inferred: false });
    });
    for (const run of [...runs].sort((a, b) => a.start - b.start || a.stint - b.stint)) {
        const same = sets.filter(s => s.compound === run.compound);
        const matches = run.startAge === null ? [] : same.filter(s => s.history.length && s.age === run.startAge)
            .sort((a, b) => a.lastUsed - b.lastUsed || a.id.localeCompare(b.id));
        // Unknown age cannot establish reuse; never force a match to fit allocation.
        let set = matches[0] || same.find(s => !s.history.length);
        if (!set) {
            set = { id: `${prefix[run.compound] || '?'}${same.length + 1}`, compound: run.compound, age: null, lastUsed: null, history: [], inferred: false, extra: true };
            sets.push(set);
        }
        const alternatives = matches.slice(1).map(s => s.id);
        const endAge = run.startAge === null ? null : run.startAge + run.laps;
        set.history.push({ ...run, endAge, alternatives, reason: matches.length > 1 ? 'Least recently used matching set' : matches.length === 1 ? 'Only matching observed age' : run.startAge === 0 ? 'First observed new set' : 'First observation; earlier identity unknown' });
        set.age = endAge;
        set.lastUsed = run.start;
        set.inferred = set.inferred || run.startAge !== 0 || alternatives.length > 0;
    }
    return { sets, allocation, allocationLabel: `Assumed ${sprint ? 'sprint' : 'standard'} dry allocation`, availability: 'Returns and availability unverified' };
};
