import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Table } from '../Utils/Table';

const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:8080';

export const Home = () => {
    const [data, setData] = useState<any>(null);
    const navigate = useNavigate();

    useEffect(() => {
        fetch(`${API_BASE}/api/home`)
            .then(r => r.json())
            .then(setData);
    }, []);

    const driverColumns = [
        { header: 'Pos', accessor: 'position' },
        { header: 'Driver', accessor: 'name' },
        { header: 'Team', accessor: 'team' },
        { header: 'Points', accessor: 'points' },
        { 
            header: 'To Next', 
            accessor: (row: any) => (
                <span className={`font-mono ${row.diff_to_next === '-' ? 'text-gray-500' : 'text-red-400'}`}>
                    {row.diff_to_next}
                </span>
            ) 
        }
    ];

    const teamColumns = [
        { header: 'Pos', accessor: 'position' },
        { header: 'Team', accessor: 'name' },
        { header: 'Points', accessor: 'points' },
        { 
            header: 'To Next', 
            accessor: (row: any) => (
                <span className={`font-mono ${row.diff_to_next === '-' ? 'text-gray-500' : 'text-red-400'}`}>
                    {row.diff_to_next}
                </span>
            ) 
        }
    ];

    const pastRaceColumns = [
        { 
            header: 'Round', 
            accessor: (row: any) => (
                <Link to={`/race/${row.session_key}`} className="text-blue-400 hover:text-blue-300 hover:underline font-bold transition">
                    {row.round}
                </Link>
            ) 
        },
        { header: 'Date', accessor: (row: any) => new Date(row.date).toLocaleDateString() }
    ];

    const upcomingRaceColumns = [
        { header: 'Round', accessor: 'round' },
        { header: 'Date', accessor: (row: any) => new Date(row.date).toLocaleDateString() }
    ];

    if (!data) return <div className="p-10 text-white animate-pulse">Loading Dashboard...</div>;
    console.log('🚀 Home page data:', data); // Debugging line to inspect the fetched data

    return (
        <div className="min-h-screen bg-black text-white p-6 flex flex-col gap-6">
            <div className="flex justify-between items-center bg-gray-900 p-4 rounded-xl border border-gray-800">
                <h1 className="text-2xl font-bold uppercase tracking-wider text-red-500">F1 Dashboard</h1>
                <button 
                    // onClick={() => navigate(`/race/${data.liveStatus.session_key}`)}
                    onClick={() => navigate(`/race/live`)}
                    disabled={!data.liveStatus.isLive}
                    className={`px-6 py-2 rounded font-bold uppercase tracking-widest transition ${
                        data.liveStatus.isLive ? 'bg-red-600 hover:bg-red-500 text-white animate-pulse' : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                    }`}
                >
                    {data.liveStatus.isLive ? 'Live Session Active' : 'No Live Session'}
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                {/* 
                    FIX: Changed wrapper to flex-col and moved overflow to an inner div. 
                    This ensures the padding is NOT part of the scroll area, preventing the transparent gap above the sticky header.
                */}
                <div className="bg-gray-900 rounded-xl border border-gray-800 h-[800px] flex flex-col overflow-hidden shadow-xl">
                    <div className="p-5 pb-0">
                        <h2 className="font-bold uppercase tracking-wider text-gray-400 mb-4">Driver Standings</h2>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar px-5 pb-5">
                        <Table data={data.drivers} columns={driverColumns} />
                    </div>
                </div>

                <div className="bg-gray-900 rounded-xl border border-gray-800 h-[800px] flex flex-col overflow-hidden shadow-xl">
                    <div className="p-5 pb-0">
                        <h2 className="font-bold uppercase tracking-wider text-gray-400 mb-4">Constructor Standings</h2>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar px-5 pb-5">
                        <Table data={data.teams} columns={teamColumns} />
                    </div>
                </div>

                <div className="bg-gray-900 rounded-xl border border-gray-800 h-[800px] flex flex-col overflow-hidden shadow-xl">
                    <div className="p-5 pb-0">
                        <h2 className="font-bold uppercase tracking-wider text-gray-400 mb-4">Past Races</h2>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar px-5 pb-5">
                        <Table data={data.pastRaces} columns={pastRaceColumns} />
                    </div>
                </div>

                <div className="bg-gray-900 rounded-xl border border-gray-800 h-[800px] flex flex-col overflow-hidden shadow-xl">
                    <div className="p-5 pb-0">
                        <h2 className="font-bold uppercase tracking-wider text-gray-400 mb-4">Upcoming Races</h2>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar px-5 pb-5">
                        <Table data={data.upcomingRaces} columns={upcomingRaceColumns} />
                    </div>
                </div>
            </div>
        </div>
    );
};