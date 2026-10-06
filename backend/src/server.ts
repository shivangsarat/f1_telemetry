import express from 'express';
import http from 'http';
import cors from 'cors';
import path from 'path';
import { apiRouter } from './routes/apiRoutes';
import { setupWebSocket } from './websocket/streamHandler';

const app = express();
app.use(cors());

app.use('/api', apiRouter);

const frontendDistPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDistPath));

app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(frontendDistPath, 'index.html'));
});

const server = http.createServer(app);
const PORT = process.env.PORT || 8080;

const start = async () => {
    try {
        await setupWebSocket(server);
        server.listen(PORT, () => console.log(`🏎️  F1 Production Server running on port ${PORT}`));
    } catch (error) {
        console.error('❌ Failed to start F1 backend:', error);
        process.exitCode = 1;
    }
};

void start();
