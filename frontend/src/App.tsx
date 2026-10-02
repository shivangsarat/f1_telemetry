import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Home } from './Pages/Home';
import { Dashboard } from './Pages/Dashboard';
import { DriverProfile } from './Pages/DriverProfile';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        {/* Handles both /race/live and /race/9158 */}
        <Route path="/race/:sessionKey" element={<Dashboard />} />
        <Route path="/race/:sessionKey/driver/:driverId" element={<DriverProfile />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;