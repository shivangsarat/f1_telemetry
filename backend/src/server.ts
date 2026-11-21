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
/** Prevent caching the SPA entry point so a normal browser refresh discovers the latest hashed assets. */
function setStaticCacheHeaders(response: http.ServerResponse, filename: string): void {
    if (path.basename(filename) === 'index.html') response.setHeader('Cache-Control', 'no-cache, must-revalidate');
}
app.use(express.static(frontendDistPath, { setHeaders: setStaticCacheHeaders }));

app.get(/.*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
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
