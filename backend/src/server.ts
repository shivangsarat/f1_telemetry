import express from 'express';
import http from 'http';
import cors from 'cors';
import { apiRouter } from './routes/apiRoutes';
import { setupWebSocket } from './websocket/streamHandler';

const app = express();
app.use(cors());

app.use('/api', apiRouter);

const server = http.createServer(app);
setupWebSocket(server);

server.listen(8080, () => console.log('F1 Optimized Server running on port 8080'));