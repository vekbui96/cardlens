---
name: ship
description: Verify, commit, and deploy CardLens to GitHub Pages and the self-hosted server. Use when changes are ready to go live, or when asked to deploy, ship, or push CardLens.
---

# Ship CardLens

Two independent deploy targets. Skipping the second is the mistake that has actually happened: the server ran stale validation that rejected finishes the client could produce, and rows were silently dropped on sync.

## 1. Verify

```bash
npm run verify   # format:check + typecheck + lint + test
npx playwright test
npm run build
```

If `format:check` fails, run `npm run format` — script-applied edits (python/sed) never respect Prettier, and CI enforces it.

## 2. Decide what needs deploying

```bash
git diff --stat <last-deployed-sha>..HEAD -- server/ src/models/finishes.ts src/models/cards.ts src/storage/printings.ts src/integrations/tcgdex/
```

Anything there means **the server needs deploying too**, not just Pages. Those files are shared — see `tsconfig.node.json`.

## 3. Commit and push

Explain _why_ in the message, including any measurement that drove the change. Then push to `main`.

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

```bash
ssh server-pc "powershell -NoProfile -Command \"git -C D:\services\cardlens fetch origin main --quiet; git -C D:\services\cardlens reset --hard origin/main --quiet; Write-Host (git -C D:\services\cardlens rev-parse --short HEAD); Restart-Service cardlens; Start-Sleep -Seconds 8; (Get-Service cardlens).Status\""
```

## 6. Verify it live

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
