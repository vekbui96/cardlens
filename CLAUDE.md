# CLAUDE.md

CardLens — Pokémon card search, pricing and collection tracking for **Meta Ray-Ban Display** glasses. Vite + React + TypeScript, deployed to GitHub Pages, with a companion Express server self-hosted on a home machine.

Most of what follows was learned the hard way. Where a claim came from measurement, the number is included so it can be re-checked rather than trusted.

**Starting a session?** `docs/handoff.md` says where things stand right now — what is half-built, what is waiting on the user's device, and what not to re-litigate. This file is the durable knowledge; that one is the current state.

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
- **`variantId: "generated"` means TCGdex invented the variant** and it carries no information. Whole older sets are like this — measured, all 69 Hidden Fates and all 196 Team Up cards report one made-up `normal` printing while the only tcgplayer key is `holofoil`. Matching the price key against that placeholder type silently dropped prices for 12/69 and 45/196 cards, the expensive ones. A lone generated variant now takes a lone market price; two prices stays unpriced. Modern sets (me05) are never generated and are unaffected.
- Price keys observed across 526 fully-measured cards: `normal`, `holofoil`, `reverse-holofoil`, and nothing else. `1st-edition-holofoil` never appears — 1st Edition rides as a `stamp` on a `holo` variant with `pricing: null`.

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

### Binders converge per binder, last write wins — NOT as an OR-Set

`src/storage/binders.ts`, shared with the server the same way `printings.ts` is.

The collection merges per `(card, finish)` because two devices marking different
cards are both right. A binder is one arrangement: pocket 4 of page 2 holds
exactly one card, and merging pocket by pocket would produce a page neither
person laid out. Granularity is per **binder** so editing different binders on
two devices never conflicts — the case that actually happens — and only
concurrent edits to the same binder lose the older one.

Everything else follows the collection's rules deliberately: **deletes are
tombstones** (`deletedAt`), ties go to the tombstone, tombstones prune at 180
days, and the watermark is `max(updatedAt, deletedAt)`. Tombstones drop their
pages — the id must survive, the contents need not.

Binder watermarks are **separate** from the collection's (`bindersPushedAt` /
`bindersPulledAt`). One shared pair would let a collection push move the binder
watermark past binder edits that were never sent.

Binder ids must be unique across DEVICES, not just one — they are the key the
merge converges on.

### Custom binder art lives on the server, never in the binder

A binder is pushed **whole** on every edit, so an inline data URI would go
through the sync endpoint on every pocket move and into the localStorage budget
this app has already exhausted once. So: the client resizes to ≤900px JPEG,
`POST /api/binders/images` stores the bytes, and the slot carries a 20-byte
`imageId`.

- The URL is resolved at **render** time (`imageSlotSrc`), never stored — a
  binder travels between devices that reach the server on different origins.
- Reads are unauthenticated, like a live share: the id is 16 random bytes and is
  the credential. Uploads need `COLLECTION_TOKEN`.
- **SVG is refused.** It is script execution served from the API origin.
- The id pattern is shared between `binderImages.ts` and `binderStore.ts`. An id
  one accepts and the other refuses to serve is a permanently broken pocket.
- Orphans are swept after a merge, but only images **older than 7 days**. An
  image is uploaded before the binder referencing it is pushed — the client
  debounces sync by 10 seconds — so a sweep with no age floor deletes pictures
  inside that window.

### Sync has no outbox queue

"What still needs sending" is derivable: every row stamped after the last successful push. A queue can be lost, double-applied, or drift from the data it describes; a watermark recomputes truth from the rows. A failed sync needs no cleanup.

The token lives in `localStorage`, entered per device. **It must never go in a `VITE_` variable** — this ships as a static bundle on GitHub Pages, so anything baked in at build time is public and the auth is worthless.

Sync failure is a status line, never a toast: the local write already succeeded. Only `bad-token` and `disabled` get distinct wording, because those stay broken until someone acts.

## Caching

`src/storage/caches.ts` keys carry a version suffix. **Bump it whenever `toSet`/`toSummary` gains a field the UI reads.** Adding a field invalidates nothing on its own, and these entries are long-lived — a device that cached sets before `code` existed would never refetch and simply never show it.

## Testing traps

- **The e2e API server writes to a scratch dir**, not `D:/services` — see the
  `webServer` env in `playwright.config.ts`. It also runs with a real
  `COLLECTION_TOKEN`, which is what lets `binders.spec.ts` exercise the actual
  image upload instead of asserting against a 401. Without those paths a test
  run on SERVER-PC would write into the live collection.
- **e2e runs on in-memory mocks** (`VITE_USE_MOCKS: "true"` in `playwright.config.ts`). `page.route` interception does nothing for catalog data, so network-failure behaviour cannot be tested there — use a component test with a provider you control.
- **A hanging request is not an aborted one.** An abort settles the query and lets error/empty states through; a hang pins `isLoading` forever. The Collection screen bug (permanent "Loading sets…" on the glasses) only reproduces with a promise that never resolves.
- **Verify a regression test actually fails without the fix.** Two attempts at the above passed against the bug before one reproduced it.
- Tombstone tests need plausible epoch timestamps — `deletedAt: 300` is 1970 and gets pruned as ancient before any assertion sees it.

## Server operations

- Windows services via NSSM: `solid-website-api` (:8080), `cardlens` (:8787),
  `recognition` (:8200, **loopback only**, auto-start). The recogniser is Python
  in `D:\services
ecognition\.venv`; install/reinstall with
  `06-install-recognition.ps1`. Its index is read from the cardlens checkout
  (`RECOGNITION_INDEX_DIR`), so a card-index rebuild ships with a cardlens deploy.
- **Tailscale Funnel only permits 443, 8443 and 10000**, and 443/8443 are spent.
  Anything new is therefore a loopback service that `cardlens` fronts — the
  pattern `/api/target/*` and `/api/recognize` both use.
- **`/api/recognize` is for the card SORTER, not the CardLens scanner.** The
  scanner recognises on the device via `src/scan/phash.ts`: 164KB of index,
  sub-millisecond, offline, works on the glasses. Routing it through the server
  would be slower and answer the same question.
- The service-wide CSP is `default-src 'none'`, which is right for a JSON API
  and fatal for any HTML route — it blocks inline script and style. Set a
  per-route CSP, as `/api/recognize/bench` does. Config in per-service `.env`; re-run `04-install-services.ps1` to apply changes.
- **The Target restock bot is NOT a service** — it is a scheduled task, `target-stock-checker`, at `D:\services\target-stock-checker`. It must run in the **interactive** session (LogonType Interactive, session 1) because it drives a HEADED Chromium: PerimeterX captchas headless. SSH lands in session 0, which has no desktop, so start it with `Start-ScheduledTask -TaskName target-stock-checker` and never directly. If SERVER-PC signs out, the bot stops.
- `/api/target/*` proxies to that bot's loopback API on :8788 (`server/targetBot.ts`). Three distinct tokens are involved and none is interchangeable: `TARGET_TOKEN` (device → cardlens), `TARGET_BOT_TOKEN` (cardlens → bot), `COLLECTION_TOKEN` (collection sync only). The Target token is deliberately separate from the collection one — these routes can add items to a real Target cart, and the collection token is spread across every syncing device.
- **NSSM holds log files open.** `Get-Content` and `ReadAllBytes` both fail; open with `FileShare::ReadWrite`.
- **ICMP is blocked** on SERVER-PC — ping is useless as a liveness check. Use SSH, or curl the funnel URL.
- Published via Tailscale Funnel: `https://server-pc.tail0e4194.ts.net` (:8080) and `:8443` (:8787).
- **NordVPN on the laptop blocks Tailscale**, which makes `ts.net` names resolve to the tailnet IP and time out. Test external reachability with `curl --resolve <host>:<port>:199.38.181.54`.
- PowerShell 5.1: native stderr under `$ErrorActionPreference='Stop'` becomes a terminating `NativeCommandError`; `Start-Process -PassThru` leaves `ExitCode` null until `WaitForExit()`.

## Conventions

- Screens own their `BackRow` and drive focus through `useBackableFocus`; `MenuRow` only works inside a `FocusList`, so standalone controls use `ToggleRow`.
- **A blank page kept on purpose and one left over are identical**, so nothing
  may trim trailing empty binder pages automatically. Doing so made "Add page"
  a silent no-op for as long as binders existed: the commit added the page and
  the same commit removed it. `addPage` / `removeLastPage` are explicit, and
  `reformat` compacts by re-flowing rather than by trimming.
- The mock fixtures do NOT contain Pitch Black (`me5`), which several screens
  default to — an e2e test that needs cards must switch to a set that exists,
  e.g. Obsidian Flames.
- Sets list in collector-number order (`byCollectorNumber`) — binder order, not price. Numbers are strings and not always numeric (`101a`, `TG01`, `SV001`).
- Storage reads are corruption-safe and migrate on read: total, idempotent, and cannot half-apply if the app closes mid-write.
