# F1 Telemetry — production deployment and troubleshooting

## Production contract

| Property | Pinned value |
| --- | --- |
| GitHub repository / branch | `shivangsarat/f1_telemetry` → `weekend-tyre-sets` |
| VM checkout | `/opt/f1/f1_telemetry` |
| Host listener | `127.0.0.1:8080`; only Caddy exposes it over HTTPS |
| Other application | GRIDLOCK at `/opt/f1/f1-prediction-pool`, branch `main`, port `8081` |
| Secrets | Host-only `.env` (prefer symlink to `/etc/f1-env/f1_telemetry.env`) |

## Deploy in one command

The first time you add `deploy.sh` to the VM, bootstrap its checkout once (only after inspecting any local changes):

```bash
cd /opt/f1/f1_telemetry
git status --short
git fetch origin weekend-tyre-sets
git switch weekend-tyre-sets
git pull --ff-only origin weekend-tyre-sets
```

Every later update:

```bash
cd /opt/f1/f1_telemetry
bash ./deploy.sh
```

The script checks the expected repository origin, refuses a dirty tracked tree or diverged branch, prevents concurrent deployments, and only fast-forwards the telemetry branch. It then checks the Compose loopback binding, rebuilds **only** the `f1-telemetry` service, and performs a local HTTP GET at `127.0.0.1:8080/`. It does not write environment variables or touch the GRIDLOCK checkout.

**Browser behavior:** The updated SPA entry point uses `Cache-Control: no-cache, must-revalidate`, so a normal browser refresh fetches the latest Vite asset filenames after the container restarts. Open WebSocket clients will briefly disconnect; refresh/reconnect them after deployment. Schedule the rollout between live race sessions whenever possible.

## Optional GitHub Actions deploy button

The [Manual production deploy](../.github/workflows/deploy-production.yml) workflow is scoped to `weekend-tyre-sets` and is intentionally `workflow_dispatch` only. It builds the backend, runs the weekend tyre tests, builds the frontend, and then performs the same SSH deployment.

Set up in **this repository** (and separately in GRIDLOCK, if you also want its button):

1. Create a GitHub Actions Environment named `production`. Restrict it to the production branch and add required reviewers/approval where supported.
2. Configure `PROD_SSH_HOST`, `PROD_SSH_USER`, `PROD_SSH_PRIVATE_KEY`, and `PROD_SSH_KNOWN_HOSTS` as GitHub repository/environment secrets. Verify the VM SSH host-key fingerprint through an independent trusted channel—do not disable host-key verification or blindly trust a key returned by the CI runner.
3. The deployment user must reach the VM over SSH and be able to pull the correct Git branch and access Docker. GitHub-hosted runners have changing egress IP addresses: confirm your OCI SSH/network policy permits the intended connection or use the manual VM command instead.
4. Open **Actions → Manual production deploy (F1 Telemetry) → Run workflow**, select `weekend-tyre-sets`, and approve the production environment when prompted.

The workflow never transfers the contents of `.env` through GitHub. Pushing code only triggers CI build/tests; it **does not automatically restart the dashboard**.

## Keep production keys outside Git

Docker Compose reads the existing `.env`. The script accepts a legacy repo-local file but warns that you should move it outside the checkout. The preferred path is a symlink to `/etc/f1-env/f1_telemetry.env` with mode `0600`; the repo's `.gitignore` excludes root and backend environment files. Keep a private backup of the key material before performing this migration:

```bash
sudo install -d -o "$(id -un)" -g "$(id -gn)" -m 700 /etc/f1-env
install -m 600 /opt/f1/f1_telemetry/.env /etc/f1-env/f1_telemetry.env
test -s /etc/f1-env/f1_telemetry.env
rm -- /opt/f1/f1_telemetry/.env
ln -s /etc/f1-env/f1_telemetry.env /opt/f1/f1_telemetry/.env
test -s /opt/f1/f1_telemetry/.env
```

Never put secrets into code, logs, workflow output, or tickets. The GitHub SSH secrets should not be repurposed as application credentials.

## Troubleshooting on the VM

```bash
cd /opt/f1/f1_telemetry
git branch --show-current
git log -1 --oneline
docker compose ps
curl --fail --silent --show-error http://127.0.0.1:8080/ > /dev/null && echo 'HTTP OK'
docker compose logs --tail 50 --no-color f1-telemetry
sudo journalctl -u caddy -n 50 --no-pager
```

A passing local HTTP check proves the frontend is served, **not** that live OpenF1/FastF1 provider data or WebSockets are healthy. Confirm the browser uses `wss://` via Caddy, inspect the provider's logs, and avoid changing broadcast synchronization during a live session. A Caddy 502 points to the upstream container; a TLS/ACME error needs a Caddy and firewall check.

The existing source tree has outstanding frontend ESLint warnings/errors, primarily `no-explicit-any`. CI therefore gates deployment on the successful **frontend build** and **backend build/tests**, not on its existing lint debt. Fix these types in a separate change rather than disabling safety rules across the whole codebase.

**Never** use `git reset --hard`, `git clean -fdx`, or `docker compose down -v` as a routine deployment shortcut. This service is designed to be stateless; GRIDLOCK maintains a separate persistent SQLite database and its own recovery procedure.
