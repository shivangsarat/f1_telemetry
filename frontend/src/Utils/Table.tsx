import React, { useLayoutEffect, useRef, useState } from 'react';

interface Column<T> {
    header: string;
    accessor: keyof T | ((row: T) => React.ReactNode);
    width?: string;
}

interface TableProps<T> {
    data: T[];
    columns: Column<T>[];
    expandableRender?: (row: T) => React.ReactNode;
    getRowKey?: (row: T) => string | number;
    fit?: boolean;
    animateReorder?: boolean;
}

export function Table<T>({
    data,
    columns,
    expandableRender,
    getRowKey,
    fit = false,
    animateReorder = false
}: TableProps<T>) {
    const [expandedRow, setExpandedRow] = useState<string | number | null>(null);
    const rowRefs = useRef(new Map<string | number, HTMLTableRowElement>());
    const previousRects = useRef(new Map<string | number, DOMRect>());

    useLayoutEffect(() => {
        if (!animateReorder) {
            previousRects.current.clear();
            return;
        }

        const nextRects = new Map<string | number, DOMRect>();
        rowRefs.current.forEach((element, key) => {
            const nextRect = element.getBoundingClientRect();
            nextRects.set(key, nextRect);

            const previousRect = previousRects.current.get(key);
            if (!previousRect) return;

            const deltaY = previousRect.top - nextRect.top;
            if (Math.abs(deltaY) < 1) return;

            element.getAnimations().forEach(animation => animation.cancel());
            element.animate(
                [
                    { transform: `translateY(${deltaY}px)`, opacity: 0.82 },
                    { transform: 'translateY(0)', opacity: 1 }
                ],
                {
                    duration: 520,
                    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
                    fill: 'both'
                }
            );
        });

        previousRects.current = nextRects;
    }, [data, animateReorder]);

    if (!data || !Array.isArray(data)) {
        return <div className="p-4 text-gray-500">No data available</div>;
    }

    return (
        <div className={`w-full relative min-w-0 ${fit ? 'overflow-x-hidden' : ''}`}>
            <table className={`w-full border-separate border-spacing-0 text-sm text-left ${fit ? 'table-fixed' : ''}`}>
                <thead>
                    <tr>
                        {columns.map((col, idx) => (
                            <th 
                                key={idx} 
                                className={`sticky top-0 z-50 bg-gray-900 font-bold uppercase tracking-wider text-xs border-b border-gray-700 shadow-sm ${fit ? 'px-2 py-3 break-words' : 'p-4'}`}
                                style={fit && col.width ? { width: col.width } : undefined}
                            >
                                {col.header}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                    {data.map((row, idx) => {
                        const rowKey = getRowKey ? getRowKey(row) : idx;
                        const isExpanded = expandedRow === rowKey;
                        
                        return (
                            <React.Fragment key={rowKey}>
                                <tr
                                    ref={(element) => {
                                        if (element) rowRefs.current.set(rowKey, element);
                                        else rowRefs.current.delete(rowKey);
                                    }}
                                    onClick={() => expandableRender && setExpandedRow(isExpanded ? null : rowKey)}
                                    className={`group transition-colors ${animateReorder ? 'will-change-transform' : ''} ${expandableRender ? 'cursor-pointer hover:bg-gray-800/50' : 'hover:bg-gray-800/30'} ${isExpanded ? 'bg-gray-800/30' : ''}`}
                                >
                                    {columns.map((col, colIdx) => (
                                        <td
                                            key={colIdx}
                                            className={fit ? 'px-2 py-4 align-top min-w-0 break-words whitespace-normal' : 'p-4'}
                                            style={fit && col.width ? { width: col.width } : undefined}
                                        >
                                            {typeof col.accessor === 'function' ? col.accessor(row) : String(row[col.accessor] || '-')}
                                        </td>
                                    ))}
                                </tr>
                                {expandableRender && isExpanded && (
                                    <tr>
                                        <td colSpan={columns.length} className="p-0 border-b border-gray-800/50 bg-black/40">
                                            {expandableRender(row)}
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}