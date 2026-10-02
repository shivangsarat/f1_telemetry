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