export type TrackCondition = 'neutral' | 'yellow' | 'double-yellow' | 'safety-car' | 'red';

const normalizedRaceControlText = (event: any) =>
    `${event?.flag || ''} ${event?.category || ''} ${event?.message || event?.text || ''}`
        .toUpperCase()
        .replace(/\s+/g, ' ')
        .trim();

export const parseTrackConditionFromRaceControl = (event: any): TrackCondition | null => {
    const text = normalizedRaceControlText(event);
    if (!text) return null;

    // Explicit clear/green messages terminate a prior caution state.
    if (
        /\bGREEN\b/.test(text)
        || /\bTRACK CLEAR\b/.test(text)
        || /\bCLEAR TRACK\b/.test(text)
        || /\bRACE RESUM(?:E|ED|ING)\b/.test(text)
        || /\bSESSION RESUM(?:E|ED|ING)\b/.test(text)
    ) {
        return 'neutral';
    }

    if (/\bRED FLAG\b/.test(text) || /\bFLAG RED\b/.test(text) || String(event?.flag || '').toUpperCase() === 'RED') {
        return 'red';
    }

    // Match virtual/full safety car before yellow because those messages often
    // also contain caution/yellow wording.
    if (
        /\bSAFETY CAR\b/.test(text)
        || /\bVIRTUAL SAFETY CAR\b/.test(text)
        || /\bVSC\b/.test(text)
        || /\bSC DEPLOYED\b/.test(text)
    ) {
        return 'safety-car';
    }

    if (
        /\bDOUBLE YELLOW\b/.test(text)
        || /\bDOUBLE-YELLOW\b/.test(text)
        || /\bYELLOW YELLOW\b/.test(text)
    ) {
        return 'double-yellow';
    }

    if (/\bYELLOW\b/.test(text)) return 'yellow';

    return null;
};

export const getCurrentTrackCondition = (messages: any[] = []): TrackCondition => {
    for (const message of messages) {
        const parsed = parseTrackConditionFromRaceControl(message);
        if (parsed !== null) return parsed;
    }
    return 'neutral';
};

export const getTrackConditionTheme = (condition: TrackCondition) => {
    switch (condition) {
        case 'red':
            return {
                pageClass: 'bg-red-950/25',
                frameClass: 'border-red-500/70 shadow-[inset_0_0_90px_rgba(239,68,68,0.10)]',
                panelBorderClass: 'border-red-500/40',
                accentTextClass: 'text-red-400',
                label: 'RED FLAG',
                icon: '🟥'
            };
        case 'safety-car':
            return {
                pageClass: 'bg-amber-950/25',
                frameClass: 'border-amber-400/70 shadow-[inset_0_0_90px_rgba(251,191,36,0.10)]',
                panelBorderClass: 'border-amber-400/40',
                accentTextClass: 'text-amber-300',
                label: 'SAFETY CAR',
                icon: 'SC'
            };
        case 'double-yellow':
            return {
                pageClass: 'bg-yellow-950/30',
                frameClass: 'border-yellow-300/80 shadow-[inset_0_0_90px_rgba(253,224,71,0.12)]',
                panelBorderClass: 'border-yellow-300/50',
                accentTextClass: 'text-yellow-200',
                label: 'DOUBLE YELLOW',
                icon: '🟨🟨'
            };
        case 'yellow':
            return {
                pageClass: 'bg-yellow-950/20',
                frameClass: 'border-yellow-500/60 shadow-[inset_0_0_90px_rgba(234,179,8,0.08)]',
                panelBorderClass: 'border-yellow-500/35',
                accentTextClass: 'text-yellow-300',
                label: 'YELLOW FLAG',
                icon: '🟨'
            };
        default:
            return {
                pageClass: 'bg-black',
                frameClass: 'border-transparent',
                panelBorderClass: 'border-gray-800',
                accentTextClass: 'text-green-400',
                label: '',
                icon: ''
            };
    }
};

export const getRaceControlEventTheme = (event: any) => {
    const condition = parseTrackConditionFromRaceControl(event);
    if (condition) return getTrackConditionTheme(condition);

    const flag = String(event?.flag || '').toUpperCase();
    if (flag === 'CHEQUERED' || flag === 'CHECKERED') {
        return {
            ...getTrackConditionTheme('neutral'),
            frameClass: 'border-white/60',
            panelBorderClass: 'border-white/30',
            accentTextClass: 'text-white',
            label: 'CHEQUERED',
            icon: '🏁'
        };
    }
    if (flag === 'BLUE') {
        return {
            ...getTrackConditionTheme('neutral'),
            frameClass: 'border-blue-500/60',
            panelBorderClass: 'border-blue-500/35',
            accentTextClass: 'text-blue-400',
            label: 'BLUE FLAG',
            icon: '🟦'
        };
    }

    return {
        ...getTrackConditionTheme('neutral'),
        accentTextClass: 'text-gray-300',
        label: flag || 'RACE CONTROL',
        icon: 'ℹ️'
    };
};
