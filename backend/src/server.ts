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

// Attach the WebSocket server synchronously, but do not block the HTTP listener
// on OpenF1 authentication, mock dataset preparation, or provider connection.
// The frontend can connect/retry immediately while live state initializes.
const liveSetup = setupWebSocket(server).catch(error => {
    console.error('❌ Failed to initialize F1 live provider:', error);
});

server.listen(PORT, () => {
    console.log(`🏎️  F1 Production Server running on port ${PORT}`);
});

void liveSetup;
