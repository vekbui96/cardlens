---
name: ship
description: Verify, commit, and deploy CardLens to GitHub Pages and the self-hosted server. Use when changes are ready to go live, or when asked to deploy, ship, or push CardLens.
---

# Ship CardLens

Two independent deploy targets. Skipping the second is the mistake that has actually happened: the server ran stale validation that rejected finishes the client could produce, and rows were silently dropped on sync.

**On SERVER-PC itself** (`hostname` is `Server-pc`), every `ssh server-pc "…"`
below runs locally: run the inner PowerShell command directly. The `--resolve`
NordVPN workaround is only needed on the laptop.

## 1. Verify

Hand this to the **`cardlens-test-runner`** agent (Haiku) rather than running it
inline. It runs `npm run verify`, runs e2e on the isolated ports **only when
screens changed** (paths under `src/`, `e2e/`, `public/`, `index.html`, Vite or
Playwright config), and returns a summary with each failure labelled KNOWN or
NEW. CI still runs the full e2e and visual suites on push.

- Any **NEW** failure blocks the ship. Fix it, or prove it fails on clean `main`
  too and add it to "Known failures on SERVER-PC" in `docs/testing.md`.
- If `format:check` failed, run `npm run format`: script-applied edits
  (python/sed) never respect Prettier, and CI enforces it.
- `npm run build` only if the change touches build config.

## 2. Decide what needs deploying

```bash
git diff --stat <last-deployed-sha>..HEAD -- server/ src/models/finishes.ts src/models/cards.ts src/storage/printings.ts src/integrations/tcgdex/
```

Anything there means **the server needs deploying too**, not just Pages. Those files are shared — see `tsconfig.node.json`.

## 3. Commit and push

Explain _why_ in the message, including any measurement that drove the change. Then push to `main`.

In Windows PowerShell 5.1, write the message to a file and run
`git commit -F <file>`:

- an inline `-m` containing double quotes is split into pathspecs, and the commit
  fails;
- `Set-Content -Encoding utf8` / `Out-File` prepend a BOM that ends up at the
  start of the subject.

Use `[IO.File]::WriteAllText($path, $text)`, which writes UTF-8 without a BOM.

## 4. Deploy the frontend

```bash
gh workflow run "deploy-pages.yml" --repo vekbui96/cardlens
```

Wait for it and check the conclusion — do not assume success:

```bash
gh run list --repo vekbui96/cardlens --limit 1 --json databaseId,status,conclusion
```

On failure, `gh run view <id> --log-failed`. The usual cause is formatting.

## 5. Deploy the server (when step 2 says so)

**First, did `package.json` gain a dependency?** The checkout at
`D:\services\cardlens` has its own `node_modules`, so a `git reset --hard`
brings the new `import` and not the package it names — and the service then
fails to start on a module it cannot resolve. Adding `compression` took the
service down exactly this way on 2026-08-27.

```bash
git diff <last-deployed-sha>..HEAD -- package.json | grep '^+ *"'
```

If anything comes back, install **before** restarting, and use `npm.cmd`
through cmd. PowerShell's execution policy blocks `npm.ps1`, so
`ssh server-pc "powershell ... npm install"` returns a `PSSecurityException`
buried among the other output, installs nothing, and looks like it worked:

```bash
ssh server-pc "cd /d D:\services\cardlens && npm.cmd install --no-audit --no-fund"
```

**Never `--omit=dev`.** The service is `tsx server/index.ts` and `tsx` is a
devDependency, so a production-only install deletes the thing that runs it.

Then restart:

```bash
ssh server-pc "powershell -NoProfile -Command \"git -C D:\services\cardlens fetch origin main --quiet; git -C D:\services\cardlens reset --hard origin/main --quiet; Write-Host (git -C D:\services\cardlens rev-parse --short HEAD); Restart-Service cardlens; Start-Sleep -Seconds 8; (Get-Service cardlens).Status\""
```

A status of `Paused` or `Stopped` rather than `Running` is almost always a
missing module. `Restart-Service` reports it as a `ServiceCommandException`,
which reads like a permissions problem and is not.

## 6. Verify it live

Hand this to the **`cardlens-live-check`** agent (Haiku). Give it the commit you
just deployed and a string from the feature (e.g. a new button label). It returns
a PASS/FAIL table covering:

- the live checkout's commit, the service, and health (locally and via the Funnel);
- the Pages run and the feature string in the deployed chunks;
- Mault and the recogniser.

A FAIL means stop and investigate; use `cardlens-triage` for the facts. A
passing table still doesn't prove a screen renders: for UI changes, load the page
and look at it.

The manual commands, for reference or when working from the laptop:

The server, from outside the LAN. `--resolve` is required on the laptop because NordVPN blocks Tailscale, so `ts.net` names otherwise resolve to an unreachable tailnet IP:

```bash
R="--resolve server-pc.tail0e4194.ts.net:8443:199.38.181.54"
curl -s -m 20 $R -w "\nHTTP %{http_code}\n" https://server-pc.tail0e4194.ts.net:8443/api/health
```

The frontend, by checking the **lazy chunks**, not just the entry bundle — screens are code-split, so grepping `index-*.js` for a feature gives a false negative:

```bash
idx=$(curl -s https://vekbui96.github.io/cardlens/ | grep -oE 'assets/index-[^"]+\.js' | head -1)
curl -s "https://vekbui96.github.io/cardlens/$idx" | grep -oE '[A-Za-z]+-[A-Za-z0-9_-]+\.js' | sort -u
# then grep the specific chunk for the feature string
```

## Touching collection data

**Never delete `D:/services/data/collection.json` to clear rows.** It has destroyed real data once: it wipes the server copy but leaves device rows stranded, and devices will not re-push them because their watermark says they already did.

Write tombstones instead — read the rows, re-send each with `deletedAt: now`, and the deletion propagates to every device:

```bash
R="--resolve server-pc.tail0e4194.ts.net:8443:199.38.181.54"
U="https://server-pc.tail0e4194.ts.net:8443/api/collection"
T="<COLLECTION_TOKEN from D:\services\cardlens\.env>"
curl -s $R -H "Authorization: Bearer $T" "$U"        # inspect FIRST
# then POST {"rows":[{...row, "deletedAt": <now>}]} to "$U/merge"
```

Always inspect before writing: a merge response showing more rows than were sent means real data is present.
