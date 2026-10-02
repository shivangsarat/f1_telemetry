import React from 'react';

interface Column<T> {
    header: string;
    accessor: keyof T | ((row: T) => React.ReactNode);
}

interface TableProps<T> {
    data: T[];
    columns: Column<T>[];
    expandableRender?: (row: T) => React.ReactNode;
}

export function Table<T>({ data, columns, expandableRender }: TableProps<T>) {
    if (!data || !Array.isArray(data)) {
        return <div className="p-4 text-gray-500">No data available</div>;
    }

    return (
        <div className="w-full relative">
            {/* border-separate prevents sticky header rendering bugs in modern browsers */}
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
                    {data.map((row, idx) => (
                        <React.Fragment key={idx}>
                            <tr className="hover:bg-gray-800/30 transition-colors">
                                {columns.map((col, colIdx) => (
                                    <td key={colIdx} className="p-4">
                                        {typeof col.accessor === 'function' ? col.accessor(row) : String(row[col.accessor] || '-')}
                                    </td>
                                ))}
                            </tr>
                            {expandableRender && (
                                <tr>
                                    <td colSpan={columns.length} className="p-0 border-b border-gray-800/50">
                                        {expandableRender(row)}
                                    </td>
                                </tr>
                            )}
                        </React.Fragment>
                    ))}
                </tbody>
            </table>
        </div>
    );
}