# Mock OpenF1 live replay

This branch includes a local replay server for testing the live dashboard when no real F1 session is running.

## Enable

Set in `backend/.env`:

```env
USE_MOCK_OPENF1=true
MOCK_OPENF1_SPEED=20
MOCK_OPENF1_LOOP=true
```

Then run the backend normally.

The backend will:

1. Find the latest completed OpenF1 Race session, unless `MOCK_OPENF1_SESSION_KEY` is set.
2. Download all relevant session data once:
   - sessions
   - drivers
   - championship drivers / teams
   - car data
   - location
   - laps
   - stints
   - pits
   - intervals
   - position
   - weather
   - race control
   - session result
   - meeting / circuit metadata
3. Start a local OpenF1-shaped REST server on `MOCK_OPENF1_PORT`.
4. Expose a local WebSocket replay stream at `ws://localhost:<port>/stream`.
5. Make the normal backend use the mock REST + stream instead of OpenF1.
6. Replay the race chronologically at `MOCK_OPENF1_SPEED`.
7. Loop the replay when `MOCK_OPENF1_LOOP=true`.

The frontend does not need any mock-specific changes. Use the normal `/race/live` and live driver pages.

## Replay behavior

High-frequency OpenF1 records are batched into replay frames so the backend receives a few stream frames per second rather than one network frame per raw record. The records inside those frames retain their original timing relationships, which keeps derived telemetry such as G-force estimates meaningful.

Lap data is replayed progressively:

- sector 1 update
- sector 2 update
- completed lap

Stints are also replayed progressively so a future `lap_end` is not revealed at stint start.

Each replay loop receives a fresh synthetic `session_key`. That makes the live state engine reset exactly as it would when a new live session appears.

## Controls

Status:

```
GET http://localhost:8091/control/status
```

Restart from the beginning:

```
POST http://localhost:8091/control/restart
```

Health:

```
GET http://localhost:8091/health
```

## Selecting a race

To replay a specific completed session:

```env
MOCK_OPENF1_SESSION_KEY=12345
```

If unset, the server selects the latest completed `Race` session from the current season, falling back to the previous season.

## Disable

Set:

```env
USE_MOCK_OPENF1=false
```

The backend then returns to the normal configured live provider without any frontend changes.
