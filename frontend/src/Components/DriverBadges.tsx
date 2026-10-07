export const DriverBadges = ({
    driver,
    compact = false,
    showYears = false
}: {
    driver: any;
    compact?: boolean;
    showYears?: boolean;
}) => {
    const status = driver?.champion_status;
    if (!status || (!status.titles && !status.defending && !status.clinched)) return null;

    const shell = compact
        ? 'text-[9px] px-2 py-1'
        : 'text-[10px] px-2.5 py-1';

    const years = Array.isArray(status.years) ? status.years : [];

    return (
        <span className="inline-flex items-center gap-1.5 flex-wrap">
            {status.titles > 0 && (
                <span className={`${shell} rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 font-black uppercase tracking-wider whitespace-nowrap inline-flex items-center gap-1.5`}>
                    <span aria-hidden="true">🏆</span>
                    <span className={compact ? 'text-[12px] leading-none' : 'text-sm leading-none'}>×{status.titles}</span>
                    {showYears && years.length > 0 && (
                        <span className="normal-case tracking-normal text-amber-200/80 font-bold">
                            {years.join(', ')}
                        </span>
                    )}
                </span>
            )}
            {status.defending && (
                <span className={`${shell} rounded border border-purple-500/40 bg-purple-500/10 text-purple-300 font-black uppercase tracking-wider whitespace-nowrap`}>
                    Defending
                </span>
            )}
            {status.clinched && (
                <span className={`${shell} rounded border border-green-500/50 bg-green-500/10 text-green-300 font-black uppercase tracking-wider whitespace-nowrap`}>
                    🎉 World Champion
                </span>
            )}
        </span>
    );
};
