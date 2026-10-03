import express from 'express';
import http from 'http';
import cors from 'cors';
import path from 'path';
import { apiRouter } from './routes/apiRoutes';
import { setupWebSocket } from './websocket/streamHandler';

const app = express();
app.use(cors());

// 1. Handle API Routes
app.use('/api', apiRouter);

// 2. Serve the compiled React frontend (Production Mode)
const frontendDistPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDistPath));

// Catch-all route to allow React Router to handle client-side navigation (Express 5 Safe)
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(frontendDistPath, 'index.html'));
});

const server = http.createServer(app);
setupWebSocket(server);

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`🏎️  F1 Production Server running on port ${PORT}`));