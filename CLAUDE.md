# CLAUDE.md

CardLens — Pokémon card search, pricing and collection tracking for **Meta Ray-Ban Display** glasses. Vite + React + TypeScript, deployed to GitHub Pages, with a companion Express server self-hosted on a home machine.

Most of this was learned the hard way; the numbers and incident stories live in `docs/` (index below) so they can be re-checked rather than trusted.

- **Something broken, or deploying?** `docs/runbook.md` — triage order, exact commands, outage traps.
- **Starting a session?** `docs/handoff.md` — current state, what is half-built, what not to re-litigate. This file is the durable rules.
- **Innovation loop.** `innovation/` is a daily unattended loop (`innovation/README.md`) for the loop's OWN ideas, plus requests Ve files on purpose as `loop:request` issues (Request template). Ve's direct requests in chat never go through it and need no issue. Do not edit `innovation/` as part of other work; never add the `approved` label.

## Read when… (index)

- Deploy incidents, full deploy steps, NSSM/Funnel/SSH/Target bot/metrics/CSP, box quirks: `docs/server-ops.md`
- Catalog proxy, pokemontcg.io / TCGdex quirks, batched Home prices: `docs/data-sources.md`
- Printings, OR-Set, binders, trade binders, binder art, sync, conventions rationale: `docs/domain-model.md`
- Scanner, `/api/recognize`, OCR analysis, accept-gate measurements, auto-capture: `docs/scanner.md`
- Writing or debugging tests, flaky e2e: `docs/testing.md`
- Glasses gestures history, interaction models, platform: `docs/meta-web-app.md`
- Triage and deploy commands: `docs/runbook.md`; current state: `docs/handoff.md`

## Commands

- `npm run verify` — format:check + typecheck + lint + test. Run before every commit (CI runs the same set).
- **Mechanical jobs go to the Haiku agents**, which report and never fix:
  - `cardlens-test-runner`: verify, plus e2e only when screens changed; labels failures KNOWN or NEW.
  - `cardlens-live-check`: after a deploy.
  - `cardlens-triage`: facts when something is broken.
- **End long sessions with `/reflect`**: it proposes the smallest doc/skill/agent edit for each thing that went wrong, then applies what Ve approves.

- `npm run test` / `npx vitest run <file>` — unit tests (jsdom); `npx playwright test` — e2e; `npm run dev:all` — Vite + server.
- **Prettier is enforced by CI.** Run `npm run format` after any scripted/bulk edit.
- **e2e on SERVER-PC must use isolated ports:** `CL_E2E_PORT=5273 CL_E2E_API_PORT=8887`. Default API port 8787 is the LIVE `cardlens` service and `reuseExistingServer` would reuse it, writing into the live collection.
- **Never build or deploy from Git Bash** — MSYS rewrites `VITE_BASE=/cardlens/` into a Windows path and silently breaks every asset (site down two days, Aug 2026). Use PowerShell or the workflow.
- **A blank SPA returns 200.** After any deploy, LOAD the page and look at it; a status check proves nothing.

## Deploying (details: `docs/server-ops.md`)

- Frontend (Pages): `gh workflow run "deploy-pages.yml" --repo vekbui96/cardlens`.
- Server (when `server/` or shared `src/` files in `tsconfig.node.json` changed — deploy BOTH): `ssh server-pc "powershell -NoProfile -Command \"git -C D:\services\cardlens fetch origin main --quiet; git -C D:\services\cardlens reset --hard origin/main --quiet; Restart-Service cardlens\""`
- **Pages stuck?** `deploy-pages.yml` uses `concurrency: pages, cancel-in-progress: false`, so one run stuck in `waiting` blocks all later runs. Check first, cancel the oldest: `gh api "repos/vekbui96/cardlens/actions/runs?per_page=30" --jq '.workflow_runs[] | select(.status!="completed") | {id,name,status,created_at}'`
- **New npm dependency** = a step BEFORE the restart; `npm` is not callable over SSH (PowerShell blocks `npm.ps1`). Use `ssh server-pc "cd /d D:\services\cardlens && npm.cmd install --no-audit --no-fund"`, then restart.
- **Never `--omit=dev`** — the service runs via `tsx`, a devDependency.
- **A card-index rebuild is a THIRD target:** `Restart-Service recognition` (index is cached in a module global), then check `cards` in `/api/recognize/health` against `public/card-index/latest.json`.
- Always `ssh server-pc`, never a hardcoded LAN IP.

## Platform and interaction

- Gestures arrive as plain `keydown` only: arrows swipe, `Enter` = SELECT, `Escape` = BACK. **No key-up, no auto-repeat, no hold** — a hold was tried and never fired on hardware; do not reach for it again.
- Burst detection (triple-pinch) lives on the screen, not the input adapter; timings must suit a neural band (1200ms, not 500ms).
- 600×600 additive display: black is transparent; prefer bright glyphs/shapes; no on-glasses keyboard.
- Suspect anything that differs between glasses and desktop first.
- **Two interaction models, one set of screens** (`src/app/layoutMode.ts` resolves `glasses | web | preview`; `useIsWeb()`; override `?ui=`). Glasses: focus ring + four gestures, fixed 600×600, collect-mode toggle and printing picker. Web (phone/browser): focus ring OFF, tappable 44px badges, no picker. Detection is by **shape** (small AND square = glasses), not size.

## Hard data-safety rules (rationale: `docs/domain-model.md`)

- **Printings are `type` or `type:foil` strings — never an enum.** Unknown foils are accepted and humanised. **Canonicalise finishes (`canonicalFinish`) on write as well as read.**
- **The collection is an OR-Set.** Removal is a tombstone, never a missing row; ties go to the tombstone; tombstones prune after 180 days only. **To wipe data, write tombstones — never delete files** (device watermarks would strand rows).
- Binders: last-write-wins per binder with `deletedAt` tombstones; separate watermarks from the collection; ids unique across devices.
- **Binder format gates use `isBinderFormat`** (`models/binderLayout.ts`) — never spell formats inline. Gates: `binderParse.ts`, `isBinder` in `repositories.ts` (read gate loses data), pickers. 4-pocket has no facing pages; screens call `pageGroups`, not `toSpreads`.
- Trade binder = `forTrade` flag + slot `quantity`/`condition`; defaults are never written (absent = 1 copy, unstated condition). Condition never changes a price. `POST /api/share/binder` 409s `binder_not_synced`. A `Share` row with no `kind` is a set share.
- Binder art lives on the server (`imageId`), never inline; SVG refused; orphan sweep only >7 days old.
- Sync has no outbox queue: watermark = rows stamped after last push. Sync failure is a status line, never a toast.
- **Never put the token in a `VITE_` variable** (static public bundle). It lives in `localStorage` per device.
- Server and client share `normalizeTcgplayerPricing` and `binderParse.ts`; never duplicate them.
- Never trim blank binder pages automatically; `addPage`/`removeLastPage` are explicit.

## Scanner (details: `docs/scanner.md`)

- **The accept gate must move together** in `src/scan/phash.ts` (`MIN_MARGIN` / `MIN_MARGIN_DRIFTED` / `NEAR_EXACT`) and `cardrec/judge.py` on SERVER-PC (not in this repo, not under git). Rule: `margin >= (distance <= 2 ? 8 : 10)`. Re-run `scripts/measure-gate-safety.mjs` after every `build-card-index.mjs all`; a zero-expected measurement cannot be taken on a sample.
- Scanning is server-first, device-always; the fallback is not optional. Captures are PNG, 245×342. OCR needs a native-resolution crop from the client (a Pages deploy); the server never has the pixels.
- Re-run `node scripts/measure-detail.mjs` before touching `MIN_DETAIL = 16`.
- Unsettled rows SHOW the collector number and never read it.
- The camera asks Mault (`/api/cards/identify`) only when phash is unsure, and Mault may only CONFIRM one of phash's candidates, never a card with a same-name look-alike (`src/scan/cameraMault.ts`). Mault alone leaked reprints on the eval; do not loosen to "Mault alone".

## Metrics and caching

- **Metrics are counts only** (`server/metricsStore.ts`, shared vocabulary `src/models/metricsEvents.ts`). **A new event needs a server deploy** (until then the server ignores it). The client must never surface a metrics failure.
- **Cache-version bump rule:** `src/storage/caches.ts` keys carry a version suffix — bump it whenever `toSet`/`toSummary` gains a field the UI reads.
- Service-wide CSP is `default-src 'none'`; HTML routes need a per-route CSP.

## Testing traps (details: `docs/testing.md`)

- e2e runs on in-memory mocks; `page.route` does nothing for catalog data. Mock fixtures lack Pitch Black (`me5`) — use e.g. Obsidian Flames.
- A hanging request is not an aborted one; reproduce loading bugs with a never-resolving promise.
- Verify a regression test fails without the fix.
- `e2e/bulk-mark.spec.ts` is timing-sensitive locally (use `--workers=1`); never "fix" it with synthetic `KeyboardEvent`s.
- Tombstone tests need plausible epoch timestamps (`deletedAt: 300` is pruned as ancient).

## Conventions

- Screens own their `BackRow` and use `useBackableFocus`; `MenuRow` only inside `FocusList`, else `ToggleRow`.
- Sets list in collector-number order (`byCollectorNumber`); numbers are strings (`101a`, `TG01`).
- Storage reads are corruption-safe and migrate on read.
- NSSM holds log files open (open with `FileShare::ReadWrite`); ICMP is blocked; Funnel allows only 443/8443/10000.
