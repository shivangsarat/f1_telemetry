# F1 Telemetry Dashboard

Production dashboard for live Formula 1 telemetry, broadcast synchronization, historical driver profiles, and weekend tyre sets.

The **production branch is `weekend-tyre-sets`**, not `main`. It runs independently of [GRIDLOCK](https://github.com/shivangsarat/f1-prediction-pool), which uses branch `main`.

## Deploy the latest version from the Oracle VM

```bash
cd /opt/f1/f1_telemetry
bash ./deploy.sh
```

The single root script fetches and fast-forwards the production branch, rebuilds the telemetry Docker container, and checks that the local HTTP page responds on port **8080**. It does **not** touch GRIDLOCK's port 8081 or its database.

Or use **Actions → Manual production deploy (F1 Telemetry)** after configuring GitHub's protected `production` Environment and SSH secrets. Neither workflow deploys automatically on every push, because replacing the telemetry container briefly interrupts live WebSocket sessions.

See the [production deployment and troubleshooting guide](docs/DEPLOYMENT.md) for one-time setup, browser refreshing, credentials, and support commands.
