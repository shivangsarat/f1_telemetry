import { Router } from 'express';
import { getHomeData, getRaceDetails, getCleanTelemetry } from '../services/dataService';

export const apiRouter = Router();

apiRouter.get('/home', async (req, res) => {
    res.json(await getHomeData());
});

apiRouter.get('/race-details/:sessionKey', async (req, res) => {
    res.json(await getRaceDetails(req.params.sessionKey));
});

apiRouter.get('/telemetry/:sessionKey/:driverNumber', async (req, res) => {
    const { sessionKey, driverNumber } = req.params;
    res.json(await getCleanTelemetry(sessionKey, Number(driverNumber)));
});