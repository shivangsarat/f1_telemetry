export const getTyreColor = (compound: string) => {
    const colors: Record<string, string> = { SOFT: '#FF3333', MEDIUM: '#FFFF00', HARD: '#FFFFFF', INTERMEDIATE: '#33CC33', WET: '#0066FF' };
    return colors[compound?.toUpperCase()] || '#888888';
};

export const getSegmentColor = (val: number) => {
    switch(val) {
        case 2048: return 'bg-yellow-400';
        case 2049: return 'bg-green-500';
        case 2051: return 'bg-purple-500';
        case 2064: return 'bg-blue-500'; 
        default: return 'bg-gray-700'; 
    }
};

export const getFlagTheme = (flag: string) => {
    switch(flag?.toUpperCase()) {
        case 'YELLOW': 
        case 'DOUBLE YELLOW': return { border: 'border-yellow-500', bg: 'bg-yellow-500/10', text: 'text-yellow-400', icon: '🟨' };
        case 'RED': return { border: 'border-red-500', bg: 'bg-red-500/10', text: 'text-red-500', icon: '🟥' };
        case 'GREEN': 
        case 'CLEAR': return { border: 'border-green-500', bg: 'bg-green-500/10', text: 'text-green-400', icon: '🟩' };
        case 'BLUE': return { border: 'border-blue-500', bg: 'bg-blue-500/10', text: 'text-blue-400', icon: '🟦' };
        case 'CHEQUERED': return { border: 'border-white', bg: 'bg-white/10', text: 'text-white', icon: '🏁' };
        case 'BLACK AND WHITE': return { border: 'border-gray-400', bg: 'bg-gray-400/10', text: 'text-gray-300', icon: '🏴' };
        default: return { border: 'border-gray-600', bg: 'bg-gray-800/50', text: 'text-gray-300', icon: 'ℹ️' };
    }
};

export const formatLapTime = (seconds: number | null) => {
    if (!seconds || isNaN(seconds) || seconds === Infinity) return '-';
    const m = Math.floor(seconds / 60);
    const s = (seconds % 60).toFixed(3);
    return m > 0 ? `${m}:${s.padStart(6, '0')}` : `${s}s`;
};

export const getF1Points = (position: number, isSprint: boolean = false) => {
    const pos = Number(position);
    if (isNaN(pos) || pos > (isSprint ? 8 : 10)) return 0;
    
    if (isSprint) {
        const sprintPoints = [8, 7, 6, 5, 4, 3, 2, 1];
        return sprintPoints[pos - 1] || 0;
    } else {
        const racePoints = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
        return racePoints[pos - 1] || 0;
    }
};

export const computeLiveChampionship = (activeResults: any[], isSprint: boolean = false) => {
    const mapped = activeResults.map(r => {
        const pos = Number(r.position || r.official_position || 99);
        const pointsStart = r.championship?.pointsStart ?? 0;
        const posStart = r.championship?.position !== '-' ? Number(r.championship?.position) : 99;
        
        const isFinished = r.status === 'Finished' || r.status === 'Classified';
        const pointsAddition = getF1Points(pos, isSprint);
        const pointsAfter = isFinished ? (r.championship?.points ?? (pointsStart + pointsAddition)) : (pointsStart + pointsAddition);

        return {
            driver_number: r.driver_number,
            pointsStart,
            posStart,
            pointsAfter,
            pointsAddition,
            isFinished
        };
    });

    mapped.sort((a, b) => {
        if (b.pointsAfter !== a.pointsAfter) return b.pointsAfter - a.pointsAfter;
        return a.posStart - b.posStart;
    });

    const standings: Record<number, any> = {};
    mapped.forEach((m, idx) => {
        const projectedPos = idx + 1;
        standings[m.driver_number] = {
            ...m,
            projectedPos,
            posChange: m.posStart === 99 ? 0 : m.posStart - projectedPos
        };
    });

    return standings;
};