import { Router } from 'express';
import { getWeekendTyres, getHomeData, getRaceDetails, getCleanTelemetry, getRaceControl, getSeasonRaces, getDriverSeasonProfile, getTeamSeasonProfile } from '../services/dataService';

export const apiRouter = Router();
apiRouter.get('/home', async (_req, res) => { res.json(await getHomeData()); });
apiRouter.get('/seasons/:year/races', async (req, res) => {
    const year = Number(req.params.year);
    if (!Number.isInteger(year)) {
        res.status(400).json({ error: 'Invalid season year' });
        return;
    }
    res.json({ year, races: await getSeasonRaces(year) });
});
apiRouter.get('/profiles/driver/:driverId', async (req, res) => { res.json(await getDriverSeasonProfile(req.params.driverId)); });
apiRouter.get('/profiles/team/:teamId', async (req, res) => { res.json(await getTeamSeasonProfile(req.params.teamId)); });
apiRouter.get('/race-details/:sessionKey', async (req, res) => { res.json(await getRaceDetails(req.params.sessionKey)); });
apiRouter.get('/race-control/:sessionKey', async (req, res) => { res.json(await getRaceControl(req.params.sessionKey)); });
apiRouter.get('/telemetry/:sessionKey/:driverNumber', async (req, res) => { res.json(await getCleanTelemetry(req.params.sessionKey, Number(req.params.driverNumber))); });

apiRouter.get('/weekend-tyres/:sessionKey/:driverNumber', async (req, res) => {
    const sessionKey = Number(req.params.sessionKey), driverNumber = Number(req.params.driverNumber);
    const asOf = req.query.asOf === undefined ? Date.now() : Number(req.query.asOf);
    if (!Number.isInteger(sessionKey) || sessionKey <= 0 || !Number.isInteger(driverNumber) || driverNumber <= 0 || !Number.isFinite(asOf) || asOf <= 0) {
        res.status(400).json({ error: 'Invalid session, driver or presentation time' }); return;
    }
    try { res.json(await getWeekendTyres(sessionKey, driverNumber, asOf)); }
    catch { res.status(503).json({ error: 'Weekend tyre history unavailable' }); }
});
