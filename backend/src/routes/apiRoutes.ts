import { Router } from 'express';
import { getHomeData, getRaceDetails, getCleanTelemetry, getRaceControl } from '../services/dataService';

export const apiRouter = Router();
apiRouter.get('/home', async (req, res) => { res.json(await getHomeData()); });
apiRouter.get('/race-details/:sessionKey', async (req, res) => { res.json(await getRaceDetails(req.params.sessionKey)); });
apiRouter.get('/race-control/:sessionKey', async (req, res) => { res.json(await getRaceControl(req.params.sessionKey)); });
apiRouter.get('/telemetry/:sessionKey/:driverNumber', async (req, res) => { res.json(await getCleanTelemetry(req.params.sessionKey, Number(req.params.driverNumber))); });
