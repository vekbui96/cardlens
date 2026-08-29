# CLAUDE.md

CardLens — Pokémon card search, pricing and collection tracking for **Meta Ray-Ban Display** glasses. Vite + React + TypeScript, deployed to GitHub Pages, with a companion Express server self-hosted on a home machine.

Most of what follows was learned the hard way. Where a claim came from measurement, the number is included so it can be re-checked rather than trusted.

**Something broken, or deploying?** `docs/runbook.md` is the paste-able version
— triage order, the exact commands, and the traps that have actually caused
outages.

**Starting a session?** `docs/handoff.md` says where things stand right now — what is half-built, what is waiting on the user's device, and what not to re-litigate. This file is the durable knowledge; that one is the current state.

## Commands

- `npm run verify` — **format:check + typecheck + lint + test.** Run this before every commit; CI runs the same set, and `format:check` was once missing here, so script-applied edits passed locally and failed the deploy.
- `npm run test` / `npx vitest run <file>` — unit tests (jsdom)
- `npx playwright test` — e2e
- `npm run dev:all` — Vite + companion server together

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

## Deploying

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

### Home prices the WHOLE collection, so pricing is batched and cached hard

`/api/catalog/prices?sets=a,b,c` -> `{ prices: { "<cardId>|<priceKey>": number }, missing: [] }`,
backed by `server/catalogPrices.ts`: one compact index per set, on disk, 12h TTL.

Home is the only screen that needs the second oracle for every set at once, and
it used to get it by asking `/api/catalog/cards` once per set. That proxy is a
pass-through with a **60-second** memory cache, so every visit was a fresh
upstream run against an API that fails ~25% of the time. **Measured on the live
site: nineteen concurrent calls, 4.5-6.7s each, several failing and retrying at
9s and 18s, and Home settling on "480 of 973 printings priced."**

Two things were wrong. The **payload** — Home wants `cardId -> price` and was
being sent full card summaries, images and embedded set objects included, 250 at
a time, and discarding all of it (`select=id,tcgplayer` is a fiftieth of the
bytes). And the **lifetime** — market prices move daily at most, so a 60s TTL
buys nothing and costs a full upstream run per visit. Measured after: **8669ms
cold, 97ms warm.**

- **Partial success is deliberate.** One set that cannot be priced is named in
  `missing` and the rest are still returned — Home can say "480 of 973 priced",
  but it cannot say anything at all from an empty body.
- **An empty index is never persisted.** Empty is a legitimate answer
  (pokemontcg.io prices 0/120 Pitch Black) but is indistinguishable from a
  response that arrived malformed, and caching that strands the set for 12h.
- The device keys prices `<cardId>|<priceKey>` and so does the server, via the
  **shared** `normalizeTcgplayerPricing` — it folds `unlimited` onto `normal`
  and `1stEdition*` onto the first-edition keys. A second copy of that mapping
  here would drift, and the symptom is a silently unpriced collection. Both
  pricing files are in `tsconfig.node.json` for that reason.
- `useCatalogPrices` keeps the old per-set path behind `enabled`, for the mock
  catalog and for the window where Pages has shipped and the server has not.

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

### Binder formats are gated in THREE places, and only one can lose data

`BINDER_SPECS` / `BINDER_FORMATS` / `isBinderFormat` in `models/binderLayout.ts`
are the source. The gates are `models/binderParse.ts` (what may be stored),
`isBinder` in `storage/repositories.ts` (what may be READ back), and the format
pickers. **Never spell the formats out at a gate** — use `isBinderFormat`.

The read gate is the dangerous one. It listed `"9" || "12"` inline, so adding
4-pocket produced a binder that saved and then vanished on the very next read:
created, gone, nothing said. Every unit test passed, because none of them went
through a storage round trip. `repositories.test.ts` now round-trips every
format in `BINDER_FORMATS`.

**4-pocket has no facing pages** (`hasFacingPages`). Two 2-column pages abreast
read as one 4-across grid, which is exactly what a 12-pocket page looks like —
the formats would be indistinguishable at a glance. Screens call `pageGroups`,
never `toSpreads` directly; `toSpreads` still owns the off-by-one pairing and is
tested on its own.

### A trade binder is a flag on a binder, not a second kind of object

`forTrade` on the binder; `quantity` and `condition` on a card slot. Collectors
build a trade binder exactly the way they build any other, and a set binder
becomes a trade binder the afternoon they decide to sell it — two types would
mean two screens, two sync paths and two merge rules for one thing. The flag
changes what the binder AFFORDS, never what it can hold.

- **Absent means one copy, and unstated condition.** Neither is written when it
  holds the default: a quantity of 1 is stored as no quantity at all, and
  `forTrade: false` as no flag. Every binder that predates trading has neither, and re-writing them to say "1" would stamp `updatedAt` on all of them and push the
  lot through sync to record nothing. Worse, two ways to spell the same value is
  how last-write-wins starts ping-ponging between devices that agree.
  `slotQuantity` is the single reader.
- **Unstated condition is NOT near mint.** It is a real answer and has to stay
  reachable, which is why pressing a grade it already has clears it.
- **Condition never changes a price.** The oracles publish one market price per
  printing and say nothing about what condition it assumes, so any multiplier
  ("LP is 85% of NM") would be a number this app invented and then printed
  beside real ones. It is shown next to the price and left to the traders.
- **Copies multiply the total; pockets are what get counted as priced.** A trade
  binder is the first thing here where "how many cards" and "how many pockets"
  diverge, and reporting "23 of 24 priced" over a total that summed forty cards
  would be a quiet lie about what was measured. `countBinder` returns both.
- **Validation is shared, like the merge rule.** `src/models/binderParse.ts`
  decides both what the server may STORE and what the trade page may DRAW. Two
  validators that drift fail the same way two merge rules do: the ends disagree
  about what a binder is and a pocket vanishes at one of them. The server's
  `binderStore.ts` re-exports it, so callers and tests see no change.

Trade links reuse the share store — same id space, same 16 random bytes, same
revocation, same 404 for revoked and never-existed alike. `Share` is a tagged
union and a row with **no `kind` is a set share**, because there is a live
`shares.json` on the server full of them.

`POST /api/share/binder` **refuses with 409 `binder_not_synced`** when the
server holds no copy of the binder. Minting a link that 404s for whoever it was
sent to is worse than refusing, and "share a binder you just made" is the normal
first-time case.

### Custom binder art lives on the server, never in the binder

A binder is pushed **whole** on every edit, so an inline data URI would gothrough the sync endpoint on every pocket move and into the localStorage budget
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
- **`e2e/bulk-mark.spec.ts` races a real 1200ms window, and local parallelism starves it.** The triple-pinch is three `press()` calls, each a CDP round-trip, that must all land inside the burst window the product genuinely enforces. Measured 2026-08-28: **4/4 pass at `--workers=1`, roughly 3 failures in 5 full-suite runs at the default worker count.** The product is correct in both cases — the harness simply loses the race. CI was always covered (`workers: 1`, `retries: 2`); the block now carries `test.describe.configure({ retries: 2 })` so a local full run stops crying wolf. **Do not "fix" it by dispatching synthetic `KeyboardEvent`s in the page** — they never reach `KeyboardBackedInputAdapter`, so the test passes having exercised nothing. Tried, measured as consistently failing, reverted.
- Tombstone tests need plausible epoch timestamps — `deletedAt: 300` is 1970 and gets pruned as ancient before any assertion sees it.

## Server operations

- Windows services via NSSM: `solid-website-api` (:8080), `cardlens` (:8787),
  `recognition` (:8200, **loopback only**, auto-start). The recogniser is Python
  in `D:\services\recognition\.venv`; install/reinstall with
  `06-install-recognition.ps1`. Its index is read from the cardlens checkout
  (`RECOGNITION_INDEX_DIR`), so a card-index rebuild ships with a cardlens deploy.
- **Tailscale Funnel only permits 443, 8443 and 10000**, and 443/8443 are spent.
  Anything new is therefore a loopback service that `cardlens` fronts — the
  pattern `/api/target/*` and `/api/recognize` both use.
- **The scanner is server-first, device-always** (changed 2026-08-10; it was
  device-only before). `src/web/scan/ScanScreen.tsx` POSTs each capture to
  `/api/recognize` and falls back to `src/scan/phash.ts` on any failure that is
  not a rejected token. Both sides run the same hash over the same index file —
  the Python one is a line-by-line port with a parity test — so the answers are
  identical today. The server exists on this path so it can be given a bigger
  index, better hashing, or card detection **without reshipping the Pages
  bundle**; 1,730 of 20,205 cards (8.6%) come back AMBIGUOUS and that is the gap.
  - **OCR is NOT in that list, and believing it is costs a wasted week.**
    `recogniseRemote` uploads the same **245x342** canvas the hash was taken
    from — deliberately, so the server hashes exactly what the device would.
    A collector number is ~2.5% of card height: **~8px** at that size, below
    every OCR engine's floor, against **~31px** in the 886x1237 the guide crop
    actually holds. The server can be given the OCR logic; it can never be given
    the pixels. Reading the number needs a second, native-resolution crop sent
    from the client — a Pages deploy, unavoidably. Measured 2026-08-28.
  - **Only 652 of the 1,730 are exact hash ties.** The other 1,078 sit 2-7 bits
    from their nearest neighbour, so "no better hash can touch them" is false
    for 62% of the gap. The hash is 64-bit and greyscale only (`phash.ts`
    Rec. 601 luma). Measure what a chroma channel or 128 bits does to those 1,078
    BEFORE scoping OCR — it needs no client change, no dependency, and adds no
    false-accept surface. If it works, OCR's target shrinks to 3.2%.
  - A perfect OCR would take auto-accept from 91.4% to **99.6%**: the collector
    number alone separates 1,639 of the 1,730 (94.7%). Of the 91 that survive,
    73 fall to the printed denominator and **18 are irreducible** — Gym Heroes
    vs Gym Challenge basic Energy share art, number and set total alike. - The fallback is not optional. SERVER-PC has been found powered off twice,
    and every capture records which recogniser answered so a silent failover
    cannot be mistaken for the server working.
  - Captures go as **PNG**, not JPEG: 245×342 is small either way, and lossless
    bytes are what make "server and device agree" testable rather than hopeful.
  - `/api/recognize` is rate-limited at **300/min**, not the usual 60 — a scan
    burst tops out near 85/min per device and 60 throttled ordinary use.

- **Auto-capture fires on a NEW subject, not on any change.** Three gates, in
  `src/scan/autoCapture.ts`: the frame must settle, hold enough detail to be a
  card at all (`MIN_DETAIL`), and differ from the last _captured_ hash
  (`NEW_SUBJECT_BITS`) — or the guide must have been visibly empty since.
  - `MIN_DETAIL = 16` is **measured**, not chosen: `node scripts/measure-detail.mjs`
    puts 160 real cards at min 22.4 / median 42.3 and every synthetic empty frame
    (mat, woodgrain, lit desk, a hand) under 11.4. Re-run it before touching the
    number. A perceptual hash **cannot** answer "is anything there" — it compares
    a region against its own median, so a bare desk hashes as confidently as a
    Charizard, which is why the old rule photographed the mat between every pair
    of cards.
  - Comparing against the last _frame_ is not enough. A hand reaching in to
    straighten an already-scanned card re-armed the shutter and scanned it twice.

- **The accept gate is ASYMMETRIC, and both recognisers carry it.**
  `margin >= (distance <= 2 ? 8 : 10)` — `MIN_MARGIN` / `MIN_MARGIN_DRIFTED` /
  `NEAR_EXACT` in `src/scan/phash.ts`, mirrored in `cardrec/judge.py` on
  SERVER-PC. Scanning is server-first and the client trusts the server's
  verdict, so **these must always move together**; a change to one alone is
  either inert or a silent parity break. The Python is not in this repo and not
  under git — see `docs/handoff.md`.
  - A blanket `MIN_MARGIN = 8` produced **2 false accepts** at 20,205 cards
    (`ex3-86` filed as `pop3-11`, `bw2-32` as `mcd12-6`), both at distance 4
    under crop error. It was clean at 1,709 cards: **a gate measured against a
    small index expires when the index grows.** `validate-recognition.mjs`
    builds its own index from the sets it is given and structurally cannot see
    crowding — re-run `scripts/measure-gate-safety.mjs` after every
    `build-card-index.mjs all`.
  - A blanket 10 was measured and **rejected**: same safety, but it refuses 312
    cards a perfect capture would have matched. The asymmetric rule costs none
    of them, because a flawless capture sits at distance 0.
  - **A measurement whose answer must be zero cannot be taken on a sample** —
    the second leak fell outside a stride sample and was missed entirely.
- **An unsettled row SHOWS the card's collector number, and never reads it.** 1,730 of 20,205 cards are reprints with identical artwork, and the printed
  number is usually the only thing separating them — but OCR to read it is
  blocked on pixels the server never receives (see above). So `numberBandRect`
  (`src/scan/frame.ts`) crops the band from the VIDEO at camera resolution —
  ~31px tall on a 1080p frame against ~8px in the 245x342 recognition canvas —
  and `ScanScreen` puts it directly under "Which one?" and above the candidates,
  so you read the number and then choose. **Reading it would introduce a way to
  file the wrong card silently; showing it cannot.** The band takes the full
  width of the bottom sixth rather than a per-era rectangle: the number is
  bottom-left on modern cards, bottom-right on most older ones, promos carry an
  alphanumeric with no denominator, and the card index stores no geometry to
  drive a tighter crop. It sits entirely below `ART_WINDOW`, so it can never
  perturb a hash. The crop is released as soon as a row settles confidently, so
  a batch of thirty does not hold thirty full-resolution images it will never
  show.
- **A row can be named by hand** (`src/web/scan/ScanCardPicker.tsx`, "Pick by set"). It reads the in-memory index — set list, collector numbers, names — so
  browsing 20,205 cards costs **no network**, which matters because this is the
  repair path for when recognition already failed. `Capture.manual` sits beside
  `result` rather than overwriting it, so correcting a row does not throw away
  the candidates you might want back.

- **Finish chips in review come from the printings oracle**, not a fixed
  Normal/Reverse pair (`src/web/scan/ScanFinishes.tsx`). One component per row
  because printings are per SET and a batch spans several; React Query keys on
  the set, so ten rows from one set cost one request. Falls back to
  Normal/Reverse while loading — a row with no finishes cannot be committed, so
  an absent server would make scanned cards silently unaddable.
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
