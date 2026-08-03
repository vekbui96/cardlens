# Session handoff — CardLens

Written at the end of a long session so the next one can start without re-deriving anything. Read `CLAUDE.md` first — it holds the repo's traps and measurements. This file is only "where things stand right now".

**Everything below is committed, pushed, deployed and verified unless it says otherwise.**

---

## What this app is now

It started as card search for Meta Ray-Ban Display glasses. It is now a **collection tracker** for master-set collectors, with:

- Per-**printing** tracking (`normal`, `reverse`, `holo`, `reverse:pokeball`, …), not per-card
- Per-**printing pricing** — the card sheet prices each printing separately, not once per card
- Sync to a self-hosted server (`server-pc.tail0e4194.ts.net`) with offline-first semantics
- Real printing data from TCGdex, since pokemontcg.io cannot supply it
- Two genuinely different UIs: glasses vs web/phone

## Live state

| Thing             | Where                                                               |
| ----------------- | ------------------------------------------------------------------- |
| Frontend          | https://vekbui96.github.io/cardlens/                                |
| Server (cardlens) | `https://server-pc.tail0e4194.ts.net:8443` via Tailscale Funnel     |
| Collection data   | `D:/services/data/collection.json` on SERVER-PC                     |
| Sync token        | `COLLECTION_TOKEN` in `D:\services\cardlens\.env` — NOT in the repo |
| Real collection   | ~93 rows, 50 cards, all in Pitch Black (`me5`)                      |
| Printings cache   | `D:/services/data/printings/` (30-day TTL, cache version **4**)     |
| Deployed at       | Pages `a850132`, server `e56f04e` — both verified live              |

Server endpoints: `/api/health`, `/api/collection`, `/api/collection/merge`,
`/api/printings/:setId`, `/api/catalog/cards`, `/api/catalog/sets`,
`/api/set-information/:setId`, `/api/sealed/:setId?name=`, plus the companion relay.

## Immediate next task

Nothing is half-built. The card **scanner** is the current thread.

**What exists and is live**

- `src/scan/phash.ts` — artwork hashing. Thresholds (distance 16, margin 8) are
  MEASURED, not guessed; the table is in the file. Re-run
  `node scripts/validate-recognition.mjs me5 me3 me2` after any change to it.
- `public/card-index/` — 1,709 cards from the ten collected sets, 13KB. Built by
  `scripts/build-card-index.mjs`, which checkpoints after every set.
- `#/scan` — batch scanning with **auto-capture**, review-then-commit, thumbnails.
- `#/showcase/...` — share a set as a link that carries its own data, one tile
  per printing, missing ones ghosted. Snapshot only; resharing is the update.

**Next, in the order I would do them**

1. **localStorage → IndexedDB.** The ceiling that silently ate marks is still
   there and the scanner fills it faster. Keep the OR-Set, tombstones, merge
   rule and watermark — only the backend behind `VersionedStore` changes. It
   touches every read path, so start it fresh rather than squeezing it in.
2. **Finish the full index.** `node scripts/build-card-index.mjs all`, ~45
   minutes, then commit `public/card-index/` and deploy. THREE runs have been
   stopped by the environment rather than by the script, so run it in a real
   terminal. Interruption is now survivable.
3. **Collector-number OCR.** 27 of 1,709 cards share an exact hash — all
   genuine reprints with identical art. The margin rule already refuses to
   guess; a crop of the number corner would settle them.

**Unexplained: a crash on Collection.** Not reproducible with 973 seeded rows on
desktop. An ErrorBoundary now ships, so the next occurrence shows the message
with a Copy details button instead of a blank page. Ask for that output, and for
whether it is a white screen, a freeze, or a self-reload — the last means memory,
and Collection is the heaviest screen in the app.

**A pattern worth naming.** Four bugs this session, three of the same shape: a
**silent early return** that made an action do nothing. A storage write that
failed without saying so; a capture that returned early on a 0x0 frame; a set
that indexed zero cards because the API returned empty. Treat a guard clause
that returns quietly as a smell in this codebase — it has been the single most
reliable source of "it just doesn't work".

## What the pricing work actually changed

Prices were already arriving from TCGdex and were already valuing the collection total. They
were lost at exactly one place: `buildPrintingIndex` mapped `Printing[]` to `Finish[]`,
discarding everything but the key, so the set screen had no prices at all. `useCollectionValue`
only worked because it bypassed the index and re-read the raw map.

Now: `SetPrintingIndex.prices` carries them, `printingPrice()` is the one lookup (it tries the
collector number as given, unpadded, and `padStart(3,"0")`), and `SetView` exposes `priceFor`
and `headlinePriceFor`. `useCollectionValue` was refactored onto the same lookup, so the set
screen and the collection total cannot disagree about what a printing is worth.

**A card whose set pokemontcg.io cannot price now headlines with its dearest known printing**
instead of reading "Unavailable". That matters for whole sets: measured live, pokemontcg.io
prices 0/120 Pitch Black and 0/124 Perfect Order.

## Confirmed on hardware (do not re-litigate)

- Triple-pinch on one card = bulk mark. **Works.**
- Hold gesture. **Removed** — never fired; the platform gives `keydown` only.
- Tapping printing badges on the phone. **Works** (server saw the rows land).

## Unresolved, needs the user's device

- **"Blue bar" on the glasses Sets screen.** Diagnosed three times wrongly. It is _not_ a loading state — `LoadingState` renders a spinner and text. It is the focused Back control above an **empty list**. `SetsScreen` has an empty branch that says "No sets loaded · Select to try again", so the next report should distinguish loading / error / empty / list. Ask which text appears before theorising again.
- **The web shell on a REAL phone.** It is now proven at 412x839 in Playwright (`--project=phone`, `devices["Pixel 7"]`) — no horizontal overflow, 44px touch targets, the sheet bounded and its Done button reachable. That is emulation, not a device. Nobody has held this in a hand yet.
- **Per-printing prices on the glasses.** The prices are on `SetView` and the glasses could show them, but only the phone sheet does. Whether a 600x600 additive display has room is a judgement nobody has made on hardware.

## Things that bit hard this session

Full detail in `CLAUDE.md`; the shortlist:

- **TCGdex does not publish first-edition price keys.** A whole task was planned on the assumption it did. Measured across every card in me05, me03, sv08.5 and base1 — 526 cards — the only keys that exist are `normal`, `holofoil`, `reverse-holofoil`. TCGdex carries 1st Edition as a `stamp` on a `holo` variant with `pricing: null`. The three-key mapping was already complete. **Do not add a price key without measuring for it first.**
- **A Playwright project with no `testMatch` runs every spec.** Adding a `phone` project silently re-ran all eight glasses specs at 412x839, where the app resolves to the web shell — five failed and CI would have gone red. The project is now scoped to `phone-layout.spec.ts`.
- **The card sheet's Done button was inside the scrolling region.** With 12 printings it sat at 1098px against an 844px viewport. Fixed by pinning `.close` outside a new `.scroll` wrapper. It was invisible for months because the mock fixtures give each card one printing — **an assertion that cannot be stressed cannot catch anything.**
- **Prettier does not read `.gitignore`.** Git-ignored scratch directories still fail `format:check` until they are in `.prettierignore`.
- A cache-version bump is for **shape** changes, **or for a field callers already read starting to hold a materially different value** — that second case is why `PRINTINGS_CACHE_VERSION` is now 4. Without it, sets cached before a pricing fix keep serving the old numbers for 30 days and look correct doing it. The client's `cache:printings:v4` has to move in the same commit or only devices with no cache see the fix. Still do not bump when the output is byte-identical: that costs a full refetch of every set (120–295 requests each) and buys nothing.
- **A price key that disagrees with the variant type is not always wrong.** TCGdex marks invented variants `variantId: "generated"`, and whole older sets are invented — see `CLAUDE.md`. Strict key-to-type matching quietly dropped the prices of the most valuable cards in Hidden Fates and Team Up.

## Ideas discussed, not started

- Home screen refinements beyond the resume row and progress bars already shipped.
- **Rejected: proxying card images through the server.** Residential upload is slower than the CDN, the glasses reach it through a relay rather than the LAN, a single set is 10–25 MB of thumbnails, and an outage would blank every image. Cache on the device instead if offline art matters.

## Housekeeping still open

- ~~`collection.json` has no backup~~ — done. `D:\services\scripts\backup-collection.ps1` runs under scheduled task `cardlens-backup` (daily 03:00 and at startup), refuses to snapshot unparseable or empty JSON, skips identical snapshots, keeps 30.
- SERVER-PC BIOS: **AC Recovery → Power On** is not set, so it stays off after a power cut. It has been found powered off twice.
- `solid-website-api` deploy key not registered, so that server rebuilds sideloaded source rather than pulling. Does not affect CardLens.
- `useCollectionValue` still has no direct test, and it computes what the collection is worth. The refactor onto the shared lookup was verified equivalent by review, not by a test.
