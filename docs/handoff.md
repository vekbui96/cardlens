# Session handoff — CardLens

Written at the end of a long session so the next one can start without re-deriving anything. Read `CLAUDE.md` first — it holds the repo's traps and measurements. This file is only "where things stand right now".

**Everything below is committed, pushed, deployed and verified unless it says otherwise.**

---

## What this app is now

It started as card search for Meta Ray-Ban Display glasses. It is now a **collection tracker** for master-set collectors, with:

- Per-**printing** tracking (`normal`, `reverse`, `holo`, `reverse:pokeball`, …), not per-card
- Sync to a self-hosted server (`server-pc.tail0e4194.ts.net`) with offline-first semantics
- Real printing data from TCGdex, since pokemontcg.io cannot supply it
- Two genuinely different UIs: glasses vs web/phone

## Live state

| Thing             | Where                                                               |
| ----------------- | ------------------------------------------------------------------- |
| Frontend          | https://vekbui96.github.io/cardlens/                                |
| Server (cardlens) | `https://server-pc.tail0e4194.ts.net:8443` via Tailscale Funnel     |
| Collection data   | `D:/services/data/collection.json` on SERVER-PC                     |
| Printings cache   | `D:/services/data/printings/` (30-day TTL)                          |
| Sync token        | `COLLECTION_TOKEN` in `D:\services\cardlens\.env` — NOT in the repo |
| Real collection   | ~93 rows, 50 cards, all in Pitch Black (`me5`)                      |

Server endpoints: `/api/health`, `/api/collection`, `/api/collection/merge`,
`/api/printings/:setId`, `/api/catalog/cards`, `/api/catalog/sets`,
`/api/set-information/:setId`, plus the companion relay.

## Immediate next task

**Deploy the `/api/set-information/:setId` wiring.** Written and verified locally
(`npm run verify` + `npx playwright test` both green), **not yet committed or deployed.**

`useSetInformation` (`src/hooks/useSetInformation.ts`) now collapses the set screen's three
requests into one, and `SetCardsScreen` filters by rarity in memory. The fallback to the
per-query path is kept and covered by tests: it engages when the aggregate errors, when the
server is unreachable, and when it answers with an empty set.

**Both halves must ship** — `server/index.ts` changed too, so this needs the Pages workflow
_and_ the server deploy. The client accepts the printings payload in either shape, so the
order does not matter and a stale server will not break the screen.

Rationale and the rest of the backlog: `docs/performance-plan.md`.

## Unresolved, needs the user's device

- **"Blue bar" on the glasses Sets screen.** Diagnosed three times wrongly. It is _not_ a loading state — `LoadingState` renders a spinner and text. It is the focused Back control above an **empty list**. `SetsScreen` now has an empty branch that says "No sets loaded · Select to try again", so the next report should distinguish loading / error / empty / list. Ask which text appears before theorising again.
- **Web shell on a real phone.** Row heights and touch targets were tuned for a 600×600 square. Never seen at 390×844.

## Confirmed on hardware (do not re-litigate)

- Triple-pinch on one card = bulk mark. **Works.**
- Hold gesture. **Removed** — never fired; the platform gives `keydown` only.
- Tapping printing badges on the phone. **Works** (server saw the rows land).

## Things that bit hard this session

Full detail in `CLAUDE.md`; the shortlist:

- The deployed app called pokemontcg.io **directly** for months of code — the resilient proxy existed and nothing used it, because `VITE_API_BASE_URL` was never set in the Pages workflow. Now set via the `CATALOG_API_BASE_URL` repo variable.
- `index.html` hardcoded `width=600, height=600` in the viewport meta, so **every device** reported a 600×600 viewport and phones were indistinguishable from the glasses.
- Deploying Pages without deploying the server left stale validation silently dropping synced rows.
- **Deleting `collection.json` destroyed 9 real rows.** To clear data, write tombstones — deleting leaves device rows stranded, and devices will not re-push them.
- `npm run verify` did not include `format:check` (CI does), so script-applied edits failed the deploy.

## Ideas discussed, not started

- **Mobile-first UI from scratch** (user is keen): card-image grid, bottom sheet per card, "missing only" filter, per-printing prices — TCGdex already returns TCGplayer and Cardmarket prices per variant and we discard them.
- Home screen: web shows a resume row, live counts and progress bars; glasses deliberately keep a fixed menu.
- **Rejected: proxying card images through the server.** Residential upload is slower than the CDN, the glasses reach it through a relay rather than the LAN, a single set is 10–25 MB of thumbnails, and an outage would blank every image. Cache on the device instead if offline art matters.

## Housekeeping still open

- `D:/services/data/collection.json` has **no backup**; `D:\services\backups\` exists and is empty.
- SERVER-PC BIOS: **AC Recovery → Power On** is not set, so it stays off after a power cut.
- `solid-website-api` deploy key not registered, so the server rebuilds sideloaded source rather than pulling.
