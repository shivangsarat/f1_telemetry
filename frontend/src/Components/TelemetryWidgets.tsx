import React from 'react';
import { getSegmentColor } from '../Utils/helpers';

export const MiniSectors = React.memo(({ segments }: { segments: number[] }) => {
    if (!segments || segments.length === 0) return null;
    return (
        <div className="flex h-1.5 w-full mt-1 gap-[1px]">
            {segments.map((val, i) => (
                <div key={i} className={`flex-1 ${getSegmentColor(val)} rounded-sm`} />
            ))}
        </div>
    );
});

export const SectorBlock = React.memo(({ sectors }: { sectors: any }) => {
    if (!sectors) return null;
    return (
        <div className="flex gap-6 font-mono text-gray-300 text-xs mt-1">
            {['s1', 's2', 's3'].map((sectorKey, idx) => {
                const speedKeys = ['i1_speed', 'i2_speed', 'st_speed'];
                const speedVal = sectors[speedKeys[idx]];
                const isTrap = sectorKey === 's3';

                return (
                    <div key={sectorKey} className="w-20 flex flex-col justify-end">
                        <span className="block text-gray-400 mb-0.5">{sectorKey.toUpperCase()}:</span>
                        <strong className="text-white text-sm block mb-1">
                            {sectors[sectorKey] ? `${sectors[sectorKey].toFixed(3)}s` : '-'}
                        </strong>
                        <div className="h-8 flex flex-col justify-start">
                            {speedVal && (
                                <span className={`text-[10px] font-bold leading-tight ${isTrap ? 'text-purple-300' : 'text-gray-100'}`}>
                                    {isTrap ? 'Trap:' : `I${idx + 1}:`} {speedVal}<br/>km/h
                                </span>
                            )}
                        </div>
                        <MiniSectors segments={sectors[`seg${idx + 1}`]} />
                    </div>
                );
            })}
        </div>
    );
});