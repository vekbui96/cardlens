# Web plan — phone and desktop

The glasses are done enough. This is the plan for the _other_ client: the thing you open on a phone in a card shop, or on a laptop at a desk.

Written the same way as `docs/performance-plan.md` — where a number is quoted it was measured, where it is a guess it says so. Read `CLAUDE.md` for the repo's traps first.

Status: **plan.** Items marked **done** shipped on 2026-07-31/08-01 and are noted only so the sequencing makes sense.

---

## Where web actually is

**Done:**

- **Its own navigation model.** Browser history, hash-backed. Back gesture pops a screen, refresh keeps you where you were, screens are linkable. Hash rather than paths because GitHub Pages has no SPA fallback and `/cardlens/sets` 404s on refresh.
- **Its own set screen.** Card-image grid, rarity chips, "missing only" filter, bottom sheet per card with one tappable row per printing and a price on each. No collect mode, no printing picker — both exist on the glasses only because a pinch must be told _which_ printing it means.
- **Per-printing pricing and a collection value panel.** From TCGdex, because pokemontcg.io cannot price this collection: measured live, 130/130 Phantasmal Flames cards priced, **0/120 Pitch Black, 0/124 Perfect Order**. TCGdex covers all three at ~97% (345/353, 379/405, 386/395 printing entries priced).
- **Desktop gets the app.** Every viewport ≥720×680 used to fall through to the 600×600 bezel mock.

**What that leaves.** Only three screens branch on `useIsWeb` today — Home, SetCards, Collection. Everything else a phone user touches is still the glasses UI rendered in a taller box:

| Screen                       | State on web                                     |
| ---------------------------- | ------------------------------------------------ |
| Results (search)             | Glasses list. No filters, no grid, 40-result cap |
| Card details                 | Glasses focus-list of actions                    |
| Sets                         | Glasses list, no art, no progress                |
| Favorites / Recent / Popular | Glasses lists                                    |
| Collection                   | Glasses list + the value panel bolted on top     |

And the desktop shell is a 760px phone column centred in a black page. It is no longer _wrong_, but it uses a 1440px screen as if it were a Pixel.

---

## What is measurably not good enough

### 1. Search is one prefix query with a 40-result cap

`buildLuceneQuery` prefix-matches **the leading token only** (`name:charizard*`), adds a collector number if present, and optionally ORs rarities. `RESULT_LIMIT` is 40. Client-side ranking reorders what comes back.

Consequences, all reachable today:

- "dark charizard base set" searches `name:dark*` and ranks the rest — the set never reaches the API.
- No way to filter by set, price, or owned/missing.
- **No way to search your own collection.** With 344 printings across four sets, "do I own this?" has no answer short of navigating to the set.

### 2. Prices are static — there is no tracking

The original ask was "live price tracking". What shipped is a _current_ price per printing. There is no movement, no history, no "up 12% this week".

The data is already there and unused: TCGdex's `pricing.cardmarket` carries `trend`, `avg1`, `avg7`, `avg30` — 1/7/30-day averages — alongside the `tcgplayer` block we do read. **Caveat that matters: cardmarket is EUR, tcgplayer is USD.** Mixing them silently would be a real bug, not a rounding issue.

### 3. Nothing is verified on a real phone

The web shell is proven at 412×839 in Playwright (`--project=phone`, `devices["Pixel 7"]`): no horizontal overflow, 44px targets, sheet bounded and its Done button reachable. That is emulation. **Nobody has held this in a hand.** Emulation does not test thumb reach, scroll momentum, Safari's dynamic toolbar, or how the additive-display colour palette reads on an OLED in daylight.

### 4. The collection screen is two screens stuck together

A glasses progress list with a value panel above it. On a phone the natural object is one dashboard: worth, movement, completion, what's next.

### 5. Known performance debt that will bite web first

From `performance-plan.md`, the items that matter _more_ on web because lists are longer and sessions are longer:

- **Item 5** — every mark rewrites the whole collection (O(n) per toggle, on the main thread). The sheet makes marking fast, which makes this easier to hit.
- **Item 6** — long lists render every row. Ascended Heroes is 295 cards; the grid mounts all of them with images.
- **Item 7** — images have no width/height hints, so every tile is a layout shift.

---

## Order

1. **Search** (items 1) — the biggest gap between what web is and what a phone user expects
2. **A real collection dashboard** (item 4) + price movement (item 2)
3. **Grid virtualisation and mark batching** (item 5) — before sets of 300 become routine
4. **Desktop layout** — use the width
5. **PWA / offline** — last, and only if wanted

Item 3 (**a real device**) is not in this order because it is not code. It should happen before any of them, and it may reorder everything.

---

## The items

### A. Search worth the name

**Server-side.** A `GET /api/search` that composes what the screen needs, the same way `/api/set-information` did for the set screen:

- Multi-token name matching, not just the leading token
- Set filter, rarity filter, price range
- A higher cap with paging, since a phone scrolls

**Client-side.** A web search screen with a results _grid_ (art, not text rows), filter chips reusing the set screen's, and — the one that changes daily use — **a toggle between "catalog" and "my collection"**. Collection search needs no network at all: the rows are local.

**Effort:** medium. **Proof it worked:** "dark charizard base" returns the right card in the top 3; searching your collection for a card you own returns it offline with the network off.

### B. Collection dashboard with movement

One screen: total value, change since last week, completion per set, and the sets closest to done.

Movement needs a decision, and it is the whole design:

- **Cheap:** use cardmarket's `avg1`/`avg7`/`avg30` directly. No storage, available today, but EUR — so either show movement as a **percentage only** (currency-free, honest) or convert, which means an FX dependency nobody wants.
- **Proper:** the server snapshots per-set prices daily to an append-only file. It already fetches every card in a set; a snapshot is the same data, kept. Gives true history in our own currency and unlocks charts.

**Recommendation: percentage-only movement from cardmarket first** (a day's work, no new storage), and start daily snapshots at the same time so real history begins accumulating for later. Do not block the visible feature on the history.

**Effort:** small then medium. **Proof:** a set you have not touched shows a plausible weekly change; the snapshot file grows daily and survives a service restart.

### C. Virtualise the grid, batch the marks

Grid windowing, plus the batch mutation from `performance-plan.md` item 5 — one read-merge-write for many changes, debounced persistence, memory write staying synchronous.

**Do not batch away the local-first write.** That property is what the whole sync design rests on.

**Effort:** medium. **Proof:** measure first — Ascended Heroes time-to-first-paint, and `localStorage` write duration at 5,000 rows. Neither has been measured; without that this is theory.

### D. Desktop as a desktop

At ≥1000px: multi-column grid, a persistent sidebar for filters instead of a sticky chip row, and the card sheet as a side panel rather than a bottom sheet. The 760px cap stays for reading-width screens.

**Effort:** small-medium, mostly CSS. **Proof:** 1440×900 shows more than one column of cards and no 760px letterbox.

### E. PWA and offline art

Installable, with a service worker caching card images. This is the conclusion `performance-plan.md` already reached — cache on the device, never proxy images through the server.

**Effort:** medium. **Do it last:** a service worker caching a bad deploy is a support problem, and this app deploys often.

---

## What NOT to do

- **Do not proxy card images through the server.** Already assessed and rejected: residential upload is slower than the CDN, the glasses reach it via the Funnel relay rather than the LAN, a 300-card set is 10–25 MB of thumbnails, and an outage would blank every image.
- **Do not mix EUR and USD in one number.** cardmarket is EUR, tcgplayer USD. A total that silently adds them is wrong in a way nobody will notice.
- **Do not duplicate a screen to make it "web".** Split where web genuinely outgrows the shared one, and keep the data layer shared — `useSetView` exists so the two shells cannot disagree about what a printing is. Two presentations is the goal; two answers is the failure.
- **Do not bump a cache version for a non-shape change.** It costs a full refetch of every set (120–295 requests each) and buys nothing.
- **Do not add a TCGdex price key without measuring for it.** Measured across 526 cards in me05, me03, sv08.5 and base1, the only keys that exist are `normal`, `holofoil`, `reverse-holofoil`. A whole task was once planned on the assumption first-edition keys existed.

---

## Open questions

- **Does the glasses UI still deserve equal weight?** The collection is 344 printings and every row was marked _somewhere_. Nobody knows the split. Worth answering before spending equally on both.
- **How much desktop is real?** If the answer is "I use my phone", item D drops down the list.
- **Is a wantlist wanted?** It is a saved filter plus the OR-Set that already exists — cheap, but only if it would be used.

---

## Before any of this

`useCollectionValue` has no direct test and it computes what the collection is worth. Everything in section B builds on it.
