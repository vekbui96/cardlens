# Server operations and deploy detail

Moved out of CLAUDE.md; read when deploying, debugging the box, or touching metrics, CSP, the Target bot or SSH.

## Build and deploy incidents

**Never build or deploy from Git Bash.** MSYS rewrites any argument or env
value that looks like a Unix absolute path into a Windows one, silently.
`VITE_BASE=/cardlens/ npm run build` in Git Bash produces
`VITE_BASE=C:/Program Files/Git/cardlens/`, and every asset in `index.html`
then points at `/Program Files/Git/cardlens/assets/...`. **This took the site
down for two days in August 2026** — the page returned HTTP 200 and rendered
nothing, so every status check said healthy. Use PowerShell, or let the
workflow do it: `deploy-pages.yml` sets `VITE_BASE` in YAML, with no shell
involved, and was never affected.

The general rule that follows: **a blank SPA returns 200.** After any deploy,
LOAD the page and look at it. `curl -o /dev/null -w "%{http_code}"` cannot tell
a working site from a broken one.

**Prettier is enforced by CI.** Edits applied by script (python/sed) do not respect it, so run `npm run format` after any bulk edit.

## Deploying (full detail)

**`deploy-pages.yml` declares `concurrency: group: pages, cancel-in-progress:
false`.** A run stuck in `waiting` therefore blocks every later Pages run
indefinitely — one from 2026-08-06 held the group for two days while CI kept
passing, which looks exactly like "Actions is broken" and is not. Check for it
before diagnosing anything else:

```bash
gh api "repos/vekbui96/cardlens/actions/runs?per_page=30"   --jq '.workflow_runs[] | select(.status!="completed") | {id,name,status,created_at}'
```

Cancel the oldest stuck run and the queue drains immediately.

Two independent targets — the frontend alone is often not enough:

```bash
# 1. Frontend (GitHub Pages)
gh workflow run "deploy-pages.yml" --repo vekbui96/cardlens

# 2. Server (only when server/ or shared src/ changed)
ssh server-pc "powershell -NoProfile -Command \"git -C D:\services\cardlens fetch origin main --quiet; git -C D:\services\cardlens reset --hard origin/main --quiet; Restart-Service cardlens\""
```

The server has been silently stale before, running validation that rejected finishes the client could produce — rows were dropped on sync and it looked like nothing happened. **After changing anything under `server/` or the shared `src/` files listed in `tsconfig.node.json`, deploy both.**

**A new npm dependency is a step BEFORE the restart, and `npm` is not callable
over SSH.** The service runs from `D:\services\cardlens` with its own
`node_modules`, so `git reset --hard` brings the import but not the package, and
the service then fails to start on a module it cannot resolve. Adding
`compression` did exactly that on 2026-08-27.

Worse, the obvious fix looks like it worked and did not: PowerShell's execution
policy blocks `npm.ps1`, so `ssh server-pc "powershell ... npm install"` returns
a `PSSecurityException` amid the other output and installs nothing. Use
`npm.cmd` through cmd:

```bash
ssh server-pc "cd /d D:\services\cardlens && npm.cmd install --no-audit --no-fund"
ssh server-pc "powershell -NoProfile -Command \"Restart-Service cardlens\""
```

**Never `--omit=dev` here.** The service is `tsx server/index.ts` and `tsx` is a
devDependency, so a production-only install removes the very thing that runs it.

**A card-index rebuild is a THIRD target.** `recognition` reads its index from
the cardlens checkout, and `api.py` caches it in a module global on first use
(`if _index is None`) — so pulling new index files changes nothing until the
Python service is restarted:

```bash
ssh server-pc "powershell -NoProfile -Command \"Restart-Service recognition\""
curl -s https://server-pc.tail0e4194.ts.net:8443/api/recognize/health -H "Authorization: Bearer $COLLECTION_TOKEN"
```

Skipping it is quiet and nasty: the browser falls back to an index the server
does not have, so the server answers `UNKNOWN` for cards the device recognises
fine, and server-first scanning looks like a recognition regression. Check
`cards` in the health response against `public/card-index/latest.json`.

## Box and service notes

- Windows services via NSSM: `solid-website-api` (:8080), `cardlens` (:8787),
  `recognition` (:8200, **loopback only**, auto-start). The recogniser is Python
  in `D:\services\recognition\.venv`; install/reinstall with
  `06-install-recognition.ps1`. Its index is read from the cardlens checkout
  (`RECOGNITION_INDEX_DIR`), so a card-index rebuild ships with a cardlens deploy.
- **Tailscale Funnel only permits 443, 8443 and 10000**, and 443/8443 are spent.
  Anything new is therefore a loopback service that `cardlens` fronts — the
  pattern `/api/target/*` and `/api/recognize` both use.

- **Usage metrics are counts only** (`server/metricsStore.ts`,
  `src/services/metrics.ts`, vocabulary in the SHARED `src/models/metricsEvents.ts`).
  `POST /api/metrics` takes `{ days: { "YYYY-MM-DD": { event: n } } }` behind
  `COLLECTION_TOKEN`; `GET /api/metrics/summary?days=N` is public so the
  innovation loop can read it without the token. Stored in `metrics.json` beside
  `COLLECTION_FILE` (so e2e scratch follows), 180-day retention. A new event is a
  name added to the shared list — and therefore a server deploy; until then the
  server ignores it rather than failing the flush. The client must never surface
  a metrics failure in any way.
- The service-wide CSP is `default-src 'none'`, which is right for a JSON API
  and fatal for any HTML route — it blocks inline script and style. Set a
  per-route CSP, as `/api/recognize/bench` does. Config in per-service `.env`; re-run `04-install-services.ps1` to apply changes.
- **The Target restock bot is NOT a service** — it is a scheduled task, `target-stock-checker`, at `D:\services\target-stock-checker`. It must run in the **interactive** session (LogonType Interactive, session 1) because it drives a HEADED Chromium: PerimeterX captchas headless. SSH lands in session 0, which has no desktop, so start it with `Start-ScheduledTask -TaskName target-stock-checker` and never directly. If SERVER-PC signs out, the bot stops.
- `/api/target/*` proxies to that bot's loopback API on :8788 (`server/targetBot.ts`). Three distinct tokens are involved and none is interchangeable: `TARGET_TOKEN` (device → cardlens), `TARGET_BOT_TOKEN` (cardlens → bot), `COLLECTION_TOKEN` (collection sync only). The Target token is deliberately separate from the collection one — these routes can add items to a real Target cart, and the collection token is spread across every syncing device.
- **NSSM holds log files open.** `Get-Content` and `ReadAllBytes` both fail; open with `FileShare::ReadWrite`.
- **ICMP is blocked** on SERVER-PC — ping is useless as a liveness check. Use SSH, or curl the funnel URL.
- **Never hardcode the server's LAN IP — always `ssh server-pc`.** The DHCP lease has moved three times (`.41` → `.42` → `.54`, measured 2026-08-19). Every command in this file and in `docs/runbook.md` used to read `ssh vebui@192.168.86.41`; once the lease moved they all timed out against a perfectly healthy box, which is indistinguishable from an outage and cost a full triage pass to rule out. The `server-pc` alias in `~/.ssh/config` supplies the user and resolves `server-pc.lan`, which has survived all three moves. A DHCP reservation on the router is the real fix; until then, an IP written down anywhere is a latent false alarm.
- Published via Tailscale Funnel: `https://server-pc.tail0e4194.ts.net` (:8080) and `:8443` (:8787).
- **NordVPN on the laptop blocks Tailscale**, which makes `ts.net` names resolve to the tailnet IP and time out. Test external reachability with `curl --resolve <host>:<port>:199.38.181.54`.
- PowerShell 5.1: a `gh --jq` filter containing quotes, spaces or `\(…)` gets
  split into stray arguments ("unknown argument"). Use
  `--json <fields> | ConvertFrom-Json` and format in PowerShell instead.
- PowerShell 5.1: native stderr under `$ErrorActionPreference='Stop'` becomes a terminating `NativeCommandError`; `Start-Process -PassThru` leaves `ExitCode` null until `WaitForExit()`.

## Mault (photo identification)

`POST /api/cards/identify` (behind `COLLECTION_TOKEN`, 60/min, raw `image/*`
body up to 16MB) proxies to **Mault**, a self-hosted card-recognition stack at
`D:\services\mault` (docker compose: `postgres` + `server` only; the `web`
image does not build and is not needed). API on `127.0.0.1:3001`, **loopback
only — keep it that way**; cardlens fronts it, as with the recogniser.

- **Env on the `cardlens` service** (in `D:\services\cardlens\.env`, applied to
  NSSM `AppEnvironmentExtra`): `MAULT_URL` (default `http://127.0.0.1:3001`),
  `MAULT_EMAIL`, `MAULT_PASSWORD`, `MAULT_ORG_ID`, `MAULT_COLLECTION_GUID`
  (default: the "CardLens trial" collection). The values come from the
  `TRIAL_*` lines in `D:\services\mault\.env`. Missing any of email / password
  / org → the route answers 503 `mault_unavailable` (fail closed, no call).
- The adapter signs in via `POST /local-auth/sign-in`, caches the session token
  in memory, and signs in again once on a 401. A second 401 means the
  credentials are wrong: 503, logged without the secret.
- Mault down → 503 `mault_unavailable`; wedged (>20s) → 503 `mault_timeout`;
  undecodable photo → 200 `UNKNOWN`. The web row shows the reason with Retry.
- **Restart it:** `cd D:\services\mault; docker compose up -d postgres server`
  (logs: `docker compose logs server --tail 50`). Both services carry
  `restart: unless-stopped` (postgres via `docker-compose.override.yml`, our
  local file, not upstream), so they come back with Docker Desktop — which
  must itself start at login for Mault to survive a reboot.
- **Local Mault patch: `POST /cards/photo`.** Upstream `/cards` cannot find a
  card inside a photo, so this box's Mault runs local branch `server-pc` (one
  commit on upstream, never pushed: Mault is GPLv3 and none of its code goes
  into CardLens, which only talks HTTP). Same fields and auth as `/cards`; it
  runs the corner detector (`lib/straighten-scan.ts`), dewarps like
  `lib/pi-scan/session.ts`, matches both the straightened card and the whole
  image, and adds `{ detected, corners, detectionScore, orientation }`. The
  patch, a README and a no-pull rebuild Dockerfile live in
  `D:\services\mault\patches-local\`. **After an upstream update:**
  `git fetch origin; git switch server-pc; git rebase origin/master` (or
  `git am patches-local\0001-cards-photo-route.patch` on a fresh branch), rebuild
  the server image, re-run `D:\services\mault-trial\eval-photo.mts`. Without
  the patch CardLens still works (it falls back to `/cards` on a 404), but
  photos stop matching.
- **Rebuilding Mault's server image:** `docker compose build server`, then
  `docker compose up -d postgres server`. From a non-interactive session
  (Claude Code, scheduled tasks) every pull fails with `error getting
credentials ... A specified logon session does not exist` (Docker Desktop's
  credential store). If no dependency changed, build on top of the current
  image instead: `docker build -f patches-local/Dockerfile.server-rebuild -t
mault-server .`, then `docker compose up -d --no-build postgres server` with
  `DOCKER_CONFIG` pointing at a dir whose `config.json` is `{"auths":{}}`. The
  pre-patch image is tagged `mault-server:upstream-3bd042b7` for rollback. The
  corner-detector model downloads from Hugging Face on the first
  `/cards/photo` after a rebuild (a few seconds, once).
- Smoke test: `node` script posting one of
  `D:\services\mault-trial\synthetic\src\*.png` to
  `http://127.0.0.1:8787/api/cards/identify` with the bearer token; expect a
  pokemontcg.io id in `candidates[0].cardId`. For a photo
  (`D:\services\mault-trial\photo-like\sv1-1.jpg`) also expect
  `outlineFound: true`.
