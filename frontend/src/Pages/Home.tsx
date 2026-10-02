import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Table } from '../Utils/Table';

export const Home = () => {
    const [data, setData] = useState<any>(null);
    const navigate = useNavigate();

    useEffect(() => {
        fetch('http://localhost:8080/api/home')
            .then(r => r.json())
            .then(setData);
    }, []);

    const driverColumns = [
        { header: 'Pos', accessor: 'position' },
        { header: 'Driver', accessor: 'name' },
        { header: 'Team', accessor: 'team' },
        { header: 'Points', accessor: 'points' }
    ];

    const teamColumns = [
        { header: 'Pos', accessor: 'position' },
        { header: 'Team', accessor: 'name' },
        { header: 'Points', accessor: 'points' }
    ];

    const raceColumns = [
        { header: 'Round', accessor: 'round' },
        { header: 'Location', accessor: 'location' },
        { header: 'Date', accessor: (row: any) => new Date(row.date).toLocaleDateString() },
        { header: 'Data', accessor: (row: any) => <Link to={`/race/${row.session_key}`} className="text-blue-400 hover:underline">View Data</Link> }
    ];

    if (!data) return <div className="p-10 text-white animate-pulse">Loading Dashboard...</div>;

    return (
        <div className="min-h-screen bg-black text-white p-6 flex flex-col gap-6">
            <div className="flex justify-between items-center bg-gray-900 p-4 rounded-xl border border-gray-800">
                <h1 className="text-2xl font-bold uppercase tracking-wider text-red-500">F1 Dashboard</h1>
                <button 
                    onClick={() => navigate(`/race/${data.liveStatus.session_key}`)}
                    disabled={!data.liveStatus.isLive}
                    className={`px-6 py-2 rounded font-bold uppercase tracking-widest transition ${
                        data.liveStatus.isLive ? 'bg-red-600 hover:bg-red-500 text-white animate-pulse' : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                    }`}
                >
                    {data.liveStatus.isLive ? 'Live Session Active' : 'No Live Session'}
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-gray-900 p-5 rounded-xl border border-gray-800 h-[800px] overflow-y-auto custom-scrollbar">
                    <h2 className="font-bold uppercase text-gray-400 mb-4">Driver Standings</h2>
                    <Table data={data.drivers} columns={driverColumns} />
                </div>
                <div className="bg-gray-900 p-5 rounded-xl border border-gray-800 h-[800px] overflow-y-auto custom-scrollbar">
                    <h2 className="font-bold uppercase text-gray-400 mb-4">Constructor Standings</h2>
                    <Table data={data.teams} columns={teamColumns} />
                </div>
                <div className="bg-gray-900 p-5 rounded-xl border border-gray-800 h-[800px] overflow-y-auto custom-scrollbar">
                    <h2 className="font-bold uppercase text-gray-400 mb-4">Past Races</h2>
                    <Table data={data.pastRaces} columns={raceColumns} />
                </div>
                <div className="bg-gray-900 p-5 rounded-xl border border-gray-800 h-[800px] overflow-y-auto custom-scrollbar">
                    <h2 className="font-bold uppercase text-gray-400 mb-4">Upcoming Races</h2>
                    <Table data={data.upcomingRaces} columns={raceColumns.slice(0, 3)} />
                </div>
            </div>
        </div>
    );
};