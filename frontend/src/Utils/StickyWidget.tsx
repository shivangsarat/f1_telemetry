import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

export const StickyWidget = ({ title, children }: { title: string, children: React.ReactNode }) => {
    const [minimized, setMinimized] = useState(false);
    return (
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden shadow-lg">
            <div 
                className="bg-gray-800 p-3 flex justify-between items-center cursor-pointer hover:bg-gray-700 transition"
                onClick={() => setMinimized(!minimized)}
            >
                <h3 className="font-bold text-sm uppercase tracking-wider">{title}</h3>
                {minimized ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </div>
            {!minimized && <div className="p-3 max-h-64 overflow-y-auto">{children}</div>}
        </div>
    );
};