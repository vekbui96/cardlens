# Runbook — deploying CardLens, and what to do when it breaks

For the moment something looks wrong. `CLAUDE.md` explains _why_ things are the
way they are; this is the paste-able version.

Every number and symptom here came from an actual incident, and the date is
given so it can be re-checked rather than trusted.

---

## "The site is down" — triage in order

Work down this list. It is ordered by how often each has actually been the
cause, not by how likely it feels.

### 1. Load the page. Do not check the status code.

**A blank single-page app returns HTTP 200.** This is the single most important
line in this file. On 2026-08-08 every endpoint reported healthy while the site
had been serving a blank page for two days.

```bash
curl -s "https://vekbui96.github.io/cardlens/?cb=$RANDOM" | grep -o 'src="[^"]*index-[^"]*\.js"'
```

Expected: `src="/cardlens/assets/index-XXXX.js"`

If the path is anything else — especially `/Program Files/Git/...` — the bundle
was built wrong. See [Git Bash will silently break the build](#git-bash-will-silently-break-the-build).

Then actually open it in a browser and look at it.

### 2. Is a stuck workflow blocking every deploy?

```bash
gh api "repos/vekbui96/cardlens/actions/runs?per_page=30" \
  --jq '.workflow_runs[] | select(.status!="completed") | {id,name,status,created_at}'
```

`deploy-pages.yml` declares `concurrency: group: pages, cancel-in-progress:
false`. **One run stuck in `waiting` blocks every later Pages run forever.**

On 2026-08-06 a run entered `waiting` and sat there for two days. CI kept
passing the whole time, so it looked exactly like a GitHub outage. Cancelling
that one run drained the queue and the next deploy finished in 26 seconds.

```bash
gh run cancel <id> --repo vekbui96/cardlens
```

### 3. Is the server up?

```bash
curl -s -m 15 https://server-pc.tail0e4194.ts.net:8443/api/health     # cardlens
curl -s -m 15 -o /dev/null -w "%{http_code}\n" https://server-pc.tail0e4194.ts.net/api/health   # personal site
```

`https://server-pc.tail0e4194.ts.net/` returning **404 is normal** — that is a
Spring API with no root mapping, not an outage.

```bash
ssh server-pc "powershell -NoProfile -Command \"Get-Service cardlens,solid-website-api,recognition | Format-Table Name,Status\""
```

### 4. Is it just this laptop?

NordVPN breaks Tailscale, so `ts.net` names resolve to an unreachable tailnet
IP. There is a hosts-file pin to the funnel's public address `199.38.181.54`.

**Measured 2026-08-06: that pin is what KEEPS the server reachable, not what
blocks it.** `tailscale status` reported every node offline. Re-measure before
deleting it. Backup at `hosts.bak-cardlens`.

Phones and other devices are unaffected — if it works on your phone and not
here, stop looking at the server.

---

## Deploying

Two independent targets. **The frontend alone is often not enough.**

### Frontend — GitHub Pages

Pushing to `main` deploys it. Nothing else is needed.

```bash
gh workflow run "deploy-pages.yml" --repo vekbui96/cardlens   # to force one
```

Then verify by **loading the page**, per triage step 1.

### Server — only when `server/` or shared `src/` changed

"Shared" means the files listed in `tsconfig.node.json` — currently
`storage/printings.ts`, `storage/binders.ts`, `models/binderLayout.ts`,
`models/cards.ts`, `models/finishes.ts`, `models/games.ts`, `models/sealed.ts`
and the integrations. Changing one of those is a server change even though it
lives under `src/`.

```bash
ssh server-pc "powershell -NoProfile -Command \"git -C D:\services\cardlens pull --ff-only origin main; Restart-Service cardlens\""
```

The server has been silently stale before — running validation that rejected
finishes the client could produce, so rows were dropped on sync and it looked
like nothing happened. Confirm what it is actually on:

```bash
ssh server-pc "powershell -NoProfile -Command \"git -C D:\services\cardlens log --oneline -1\""
```

---

## Git Bash will silently break the build

**Never build or deploy from Git Bash.** MSYS rewrites any argument or
environment value that looks like a Unix absolute path into a Windows one,
without warning:

```bash
VITE_BASE=/cardlens/ npm run build      # becomes C:/Program Files/Git/cardlens/
```

Every asset in `index.html` then points at `/Program Files/Git/cardlens/assets/…`,
the page loads nothing, and it returns HTTP 200 while doing it. **This took the
site down for two days in August 2026.**

The workflow sets `VITE_BASE` in YAML with no shell involved, so it was never
affected. If you must build by hand, use PowerShell:

```powershell
$env:VITE_BASE = '/cardlens/'
$env:VITE_ENABLE_DEV_PANEL = 'false'
$env:VITE_COMPANION_API_BASE_URL = 'https://server-pc.tail0e4194.ts.net:8443/api'
$env:VITE_API_BASE_URL = 'https://server-pc.tail0e4194.ts.net:8443/api/catalog'
npm run build
Copy-Item dist\index.html dist\404.html
Select-String -Path dist\index.html -Pattern 'src="[^"]*"' | Select -First 1
```

That last line is not optional. Check the path before publishing.

The same conversion silently mangles `curl` paths and `ssh` command strings, so
if output contains `C:/Program Files/Git/` where a URL path belongs, this is
why.

---

## What runs on SERVER-PC

|                     | port | how                | notes                                          |
| ------------------- | ---- | ------------------ | ---------------------------------------------- |
| `solid-website-api` | 8080 | NSSM service       | funnel `:443`                                  |
| `cardlens`          | 8787 | NSSM service       | funnel `:8443`                                 |
| `recognition`       | 8200 | NSSM service       | **loopback only**, fronted at `/api/recognize` |
| target stock bot    | 8788 | **scheduled task** | loopback; needs the interactive desktop        |

**Tailscale Funnel only permits 443, 8443 and 10000**, and two are spent.
Anything new is a loopback service that `cardlens` fronts — the pattern
`/api/target/*` and `/api/recognize` both use.

**NSSM bakes environment variables in at INSTALL.** `Restart-Service` does NOT
pick up `.env` changes; re-run `04-install-services.ps1` (or
`06-install-recognition.ps1`). A restart alone once left every Target route
returning 503 with the code correctly deployed.

**The target bot is not a service** and does not survive an unattended reboot.
It drives a headed Chromium because PerimeterX captchas headless, so it needs
the console session. SSH lands in session 0, which has no desktop:

```bash
ssh server-pc "powershell -NoProfile -Command \"Start-ScheduledTask -TaskName target-stock-checker\""
```

Other server facts worth not rediscovering: **ICMP is blocked**, so ping is
useless as a liveness check. **NSSM holds log files open**, so `Get-Content`
and `ReadAllBytes` both fail — open with `FileShare::ReadWrite`.

**Never reach the box by IP — every `ssh` above says `server-pc` on purpose.**
The DHCP lease has moved three times (`.41` → `.42` → `.54`, measured 2026-08-19).
These commands all used to read `ssh vebui@192.168.86.41`; after the lease moved
they timed out against a perfectly healthy server, which looks exactly like the
outage you are here to diagnose. If SSH by IP fails, re-resolve `server-pc.lan`
before concluding anything — and do not write the new number down, fix it with a
DHCP reservation on the router instead.

`server-pc.lan` itself resolves through the router and **occasionally misses**,
giving `ssh: Could not resolve hostname server-pc.lan`. Measured 2026-08-21: two
misses in roughly a dozen attempts, both fixed by retrying immediately, with 6/6
clean straight afterwards. **Retry once before treating it as an outage.** It is
still much the safer default — a stale IP is wrong every single time once the
lease moves, whereas the name is right on a retry.

---

## Before you commit

```bash
npm run verify        # format:check + typecheck + lint + test — same as CI
npx playwright test   # e2e
```

`format:check` was once missing from `verify`, so script-applied edits passed
locally and failed the deploy. **Prettier does not read `.gitignore`** — a
git-ignored scratch directory still fails until it is in `.prettierignore`.
