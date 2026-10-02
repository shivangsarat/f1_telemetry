import React, { useState } from 'react';

interface Column<T> {
    header: string;
    accessor: keyof T | ((row: T) => React.ReactNode);
}

interface TableProps<T> {
    data: T[];
    columns: Column<T>[];
    expandableRender?: (row: T) => React.ReactNode;
    getRowKey?: (row: T) => string | number; // Added to keep track of exactly which row is toggled
}

export function Table<T>({ data, columns, expandableRender, getRowKey }: TableProps<T>) {
    const [expandedRow, setExpandedRow] = useState<string | number | null>(null);

    if (!data || !Array.isArray(data)) {
        return <div className="p-4 text-gray-500">No data available</div>;
    }

    return (
        <div className="w-full relative">
            <table className="w-full border-separate border-spacing-0 text-sm text-left">
                <thead>
                    <tr>
                        {columns.map((col, idx) => (
                            <th 
                                key={idx} 
                                className="sticky top-0 z-50 p-4 bg-gray-900 font-bold uppercase tracking-wider text-xs border-b border-gray-700 shadow-sm"
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
                                    onClick={() => expandableRender && setExpandedRow(isExpanded ? null : rowKey)}
                                    className={`group transition-colors ${expandableRender ? 'cursor-pointer hover:bg-gray-800/50' : 'hover:bg-gray-800/30'} ${isExpanded ? 'bg-gray-800/30' : ''}`}
                                >
                                    {columns.map((col, colIdx) => (
                                        <td key={colIdx} className="p-4">
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