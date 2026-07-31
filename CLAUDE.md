# CLAUDE.md

CardLens — Pokémon card search, pricing and collection tracking for **Meta Ray-Ban Display** glasses. Vite + React + TypeScript, deployed to GitHub Pages, with a companion Express server self-hosted on a home machine.

Most of what follows was learned the hard way. Where a claim came from measurement, the number is included so it can be re-checked rather than trusted.

## Commands

- `npm run verify` — **format:check + typecheck + lint + test.** Run this before every commit; CI runs the same set, and `format:check` was once missing here, so script-applied edits passed locally and failed the deploy.
- `npm run test` / `npx vitest run <file>` — unit tests (jsdom)
- `npx playwright test` — e2e
- `npm run dev:all` — Vite + companion server together

**Prettier is enforced by CI.** Edits applied by script (python/sed) do not respect it, so run `npm run format` after any bulk edit.

## Deploying

Two independent targets — the frontend alone is often not enough:

```bash
# 1. Frontend (GitHub Pages)
gh workflow run "deploy-pages.yml" --repo vekbui96/cardlens

# 2. Server (only when server/ or shared src/ changed)
ssh vebui@192.168.86.41 "powershell -NoProfile -Command \"git -C D:\services\cardlens fetch origin main --quiet; git -C D:\services\cardlens reset --hard origin/main --quiet; Restart-Service cardlens\""
```

The server has been silently stale before, running validation that rejected finishes the client could produce — rows were dropped on sync and it looked like nothing happened. **After changing anything under `server/` or the shared `src/` files listed in `tsconfig.node.json`, deploy both.**

## The platform (docs/meta-web-app.md)

- Gestures arrive as ordinary `keydown`: arrows for swipes, `Enter` for index pinch (SELECT), `Escape` for middle pinch (BACK).
- **`keydown` is all the docs promise.** No key-up, no auto-repeat, no hold gesture. Anything derived from those must degrade gracefully — `SELECT` fires on press until a key-up proves the device sends them, because waiting for one that never comes would make the app unusable.
- 600×600 additive display: black is transparent. Prefer bright glyphs and shape differences over colour alone; every row of chrome costs roughly two card rows of list.
- No on-glasses keyboard. Text entry is the companion phone or the letter picker.

**Anything that behaves differently on the glasses than on desktop should be suspected first.** A triple-pinch gesture worked perfectly on a keyboard and never fired on the hardware, because it lived in the input adapter and reset on any stray event the neural band produced.

### Gestures, and what is actually confirmed on hardware

| Gesture                                  | Status                                             |
| ---------------------------------------- | -------------------------------------------------- |
| Swipes, pinch, middle-pinch              | Documented and working                             |
| **Triple-pinch on one card** (bulk mark) | **Confirmed working on the glasses**               |
| Hold                                     | **Tried and removed — never fired on the glasses** |

`keydown` really is all there is: a hold derived from key-up timing and auto-repeat worked on a desktop keyboard and did nothing on the device. Do not reach for it again.

Three rules came out of getting this wrong:

- **Burst detection belongs on the screen, not the input adapter.** The adapter cannot see what is focused, so it had to reset on every other event to avoid firing during rapid marking — and any stray event from the neural band then killed the gesture silently. Keyed on the focused card it is both stricter and more forgiving.
- **Gesture timings must suit a neural band, not a mouse.** 500ms between pinches was mouse double-click timing and felt broken; 1200ms works.
- **The viewport meta once hardcoded `width=600, height=600`**, so every device reported a 600×600 layout viewport and a phone was indistinguishable from the glasses in both JS and CSS. It is `width=device-width` now; the glasses report 600 naturally and their surface is a fixed 600px in CSS regardless.

## Two interaction models, one set of screens

`src/app/layoutMode.ts` resolves `glasses | web | preview`; `useIsWeb()` is what screens branch on. Override with `?ui=`.

The screens and all logic are shared — only interaction differs, and it differs completely:

- **Glasses**: focus ring driven by four gestures, fixed 600×600, no pointer. The collect-mode toggle and printing picker exist solely because a pinch needs something to say _which_ printing it means.
- **Web** (phone/browser, **confirmed working**): focus ring OFF — it preventDefaults arrows and Enter, which fights native scrolling. Printing badges are tappable buttons with 44px targets, so collect mode and the picker are hidden as they answer a question a finger never asks.

Detection is by **shape**, not size: the glasses are small AND square, a phone is small and tall.

## Data sources

### pokemontcg.io — the catalog, and unreliable

- **Fails ~25% of the time, in bursts.** Measured: 3/12 identical requests returned 500; failures cluster in time rather than being independent, so tight retries land inside the same burst and all fail. The server proxy retries across ~4s for this reason.
- **Reports no variant data at all for some sets.** Pitch Black (`me5`) returns `prices: {}` for all 120 cards.
- **Never reports pattern foils** — no Poké Ball, Master Ball, energy, or ball-type reverses, in any set.
- 403s the default Python `urllib` user-agent. Set one when scripting.

### TCGdex — the printings oracle

- Free, no key. Used **only** to answer "which printings does this card have".
- **Variants exist only on the individual card endpoint.** The set endpoint's embedded cards carry `id, image, localId, name`, and `/cards?set=` returns the same brief shape. A set-wide answer therefore costs one request per card: 120 for Pitch Black, 295 for Ascended Heroes.
- Measured at concurrency 6: 120 cards in 1.3s / 0.28MB, 173 in 1.8s / 0.46MB, zero failures.
- Set ids differ from pokemontcg.io (`me5` vs `me05`, `sv8pt5` vs `sv08.5`), so matching is **by normalised name**: 167/174 sets join, and card numbers then resolve to `localId` for 1183/1184 sampled cards. Numbers are indexed both padded and unpadded to bridge the two.

**The server caches printings** (`/api/printings/:setId`) so devices make one 8KB request instead of 120 requests and 280KB.

## Domain model

### Printings are `type` or `type:foil` strings

`normal`, `reverse`, `holo`, `reverse:pokeball`, `reverse:masterball`, `reverse:energy`, `holo:tinsel`, `firstEdition`, `shadowless`.

**Never make this an enum.** Three 2025-26 sets introduced nine foils between them (`pokeball, masterball, tinsel, cosmos, energy, friendball, loveball, quickball, team-rocket`); anything hardcoded is wrong by the next release. Unknown foils are accepted and humanised for display.

A scalar key matters: it is the OR-Set key, so rows never change shape and sync payloads stay flat.

Legacy values (`holofoil`, `reverseHolofoil`, `pokeBall`, `masterBall`) migrate via `canonicalFinish`. **Canonicalise on write as well as read** — writing raw while reading canonical put `holofoil` and `holo` in the store as two rows for one printing, and both survived the merge.

### The collection is an OR-Set

One row per `(card, finish)` with tombstones (`src/storage/printings.ts`).

- A removal is a **tombstone, never a missing row** — a missing row is indistinguishable from "never seen", so deletions would resurrect on the next sync from a stale device.
- Merging is order-independent and idempotent; ties resolve toward the tombstone.
- Tombstones prune after 180 days. Removing them earlier lets a long-offline device resurrect deleted cards.
- **To wipe data, write tombstones — do not delete the file.** Deleting the server copy leaves device rows stranded, and the device will not re-push them because its watermark says it already did.

### Sync has no outbox queue

"What still needs sending" is derivable: every row stamped after the last successful push. A queue can be lost, double-applied, or drift from the data it describes; a watermark recomputes truth from the rows. A failed sync needs no cleanup.

The token lives in `localStorage`, entered per device. **It must never go in a `VITE_` variable** — this ships as a static bundle on GitHub Pages, so anything baked in at build time is public and the auth is worthless.

Sync failure is a status line, never a toast: the local write already succeeded. Only `bad-token` and `disabled` get distinct wording, because those stay broken until someone acts.

## Caching

`src/storage/caches.ts` keys carry a version suffix. **Bump it whenever `toSet`/`toSummary` gains a field the UI reads.** Adding a field invalidates nothing on its own, and these entries are long-lived — a device that cached sets before `code` existed would never refetch and simply never show it.

## Testing traps

- **e2e runs on in-memory mocks** (`VITE_USE_MOCKS: "true"` in `playwright.config.ts`). `page.route` interception does nothing for catalog data, so network-failure behaviour cannot be tested there — use a component test with a provider you control.
- **A hanging request is not an aborted one.** An abort settles the query and lets error/empty states through; a hang pins `isLoading` forever. The Collection screen bug (permanent "Loading sets…" on the glasses) only reproduces with a promise that never resolves.
- **Verify a regression test actually fails without the fix.** Two attempts at the above passed against the bug before one reproduced it.
- Tombstone tests need plausible epoch timestamps — `deletedAt: 300` is 1970 and gets pruned as ancient before any assertion sees it.

## Server operations

- Windows services via NSSM: `solid-website-api` (:8080), `cardlens` (:8787). Config in per-service `.env`; re-run `04-install-services.ps1` to apply changes.
- **NSSM holds log files open.** `Get-Content` and `ReadAllBytes` both fail; open with `FileShare::ReadWrite`.
- **ICMP is blocked** on SERVER-PC — ping is useless as a liveness check. Use SSH, or curl the funnel URL.
- Published via Tailscale Funnel: `https://server-pc.tail0e4194.ts.net` (:8080) and `:8443` (:8787).
- **NordVPN on the laptop blocks Tailscale**, which makes `ts.net` names resolve to the tailnet IP and time out. Test external reachability with `curl --resolve <host>:<port>:199.38.181.54`.
- PowerShell 5.1: native stderr under `$ErrorActionPreference='Stop'` becomes a terminating `NativeCommandError`; `Start-Process -PassThru` leaves `ExitCode` null until `WaitForExit()`.

## Conventions

- Screens own their `BackRow` and drive focus through `useBackableFocus`; `MenuRow` only works inside a `FocusList`, so standalone controls use `ToggleRow`.
- Sets list in collector-number order (`byCollectorNumber`) — binder order, not price. Numbers are strings and not always numeric (`101a`, `TG01`, `SV001`).
- Storage reads are corruption-safe and migrate on read: total, idempotent, and cannot half-apply if the app closes mid-write.
