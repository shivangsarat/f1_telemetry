export const DriverBadges = ({ driver, compact = false }: { driver: any; compact?: boolean }) => {
    const status = driver?.champion_status;
    if (!status || (!status.titles && !status.defending && !status.clinched)) return null;

    const base = compact
        ? 'text-[8px] px-1.5 py-0.5'
        : 'text-[9px] px-2 py-0.5';

    return (
        <span className="inline-flex items-center gap-1.5 flex-wrap">
            {status.titles > 0 && (
                <span className={`${base} rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 font-black uppercase tracking-wider whitespace-nowrap`}>
                    🏆 ×{status.titles}
                </span>
            )}
            {status.defending && (
                <span className={`${base} rounded border border-purple-500/40 bg-purple-500/10 text-purple-300 font-black uppercase tracking-wider whitespace-nowrap`}>
                    Defending
                </span>
            )}
            {status.clinched && (
                <span className={`${base} rounded border border-green-500/50 bg-green-500/10 text-green-300 font-black uppercase tracking-wider whitespace-nowrap`}>
                    🎉 World Champion
                </span>
            )}
        </span>
    );
};
