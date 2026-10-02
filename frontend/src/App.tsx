import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Suspense, lazy } from 'react';

// Standard import for the Home page
import { Home } from './Pages/Home'; 

// Lazy load the heavy pages
const Dashboard = lazy(() => import('./Pages/Dashboard').then(m => ({ default: m.Dashboard })));
const DriverProfile = lazy(() => import('./Pages/DriverProfile').then(m => ({ default: m.DriverProfile })));

const App = () => {
    return (
        <BrowserRouter>
            <Suspense fallback={
                <div className="h-screen w-screen bg-black flex items-center justify-center">
                    <span className="text-gray-500 font-bold tracking-widest uppercase animate-pulse">Loading Interface...</span>
                </div>
            }>
                <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/race/:sessionKey" element={<Dashboard />} />
                    <Route path="/race/:sessionKey/driver/:driverId" element={<DriverProfile />} />
                </Routes>
            </Suspense>
        </BrowserRouter>
    );
};

// Export as default so main.tsx can import it properly
export default App;