# Performance and downstream-call plan

Written from measurements taken while building the collection features, not from profiling a running app. Where a number is quoted it was observed; where it is an estimate it says so.

Status: **plan only.**

---

## What we know

| Thing                                | Measured                                  |
| ------------------------------------ | ----------------------------------------- |
| pokemontcg.io failure rate           | ~25%, in bursts (3/12 identical requests) |
| Set list payload                     | 44 KB                                     |
| TCGdex printings, direct from device | 120 requests / 280 KB for a 120-card set  |
| Same, via server cache               | **1 request / 8 KB**                      |
| Entry bundle                         | 119 KB (36 KB gzip)                       |
| Vendor bundle                        | 175 KB (55 KB gzip)                       |

The glasses reach the network through a tethered phone, so request _count_ matters more than bytes there.

---

## Downstream calls

### 1. The set-cards query runs twice per set view

`SetCardsScreen` calls `useSetCards(setId, rarity)` for the visible list **and** `useSetCards(setId)` unfiltered, purely to compute the master-set denominator. Two separate cache entries, two requests, for one screen.

**Fix:** fetch the set once, unfiltered, and apply the rarity filter in memory. The full list is already needed for totals, and a set is at most a few hundred cards.

**Effect:** halves set-view requests. Highest value for least work.

### 2. Catalog responses are cached in memory only

The proxy's `proxyCache` is a `Map`, bounded at 500 entries and lost on restart — and the service restarts on every deploy. Printings already cache to disk; the catalog does not.

**Fix:** give the catalog the same disk cache as printings. Sets change on release days, so a 24h TTL with stale-on-error is generous.

**Effect:** removes most upstream calls entirely, and makes the set list survive both restarts and upstream outages.

### 3. Nothing prefetches

Opening a set triggers cards, then printings, sequentially, both on first paint.

**Fix:** kick off printings as soon as a set row is _focused_, not selected. On the glasses focus dwells before selection, which is free latency to spend.

### 4. Client TTLs are shorter than the data's real lifetime

Set cards hold 6h; a released set's card list never changes. Printings hold 30 days, which is right.

**Fix:** raise set-cards to 7 days, keeping the version-suffix discipline that already exists in `caches.ts`.

---

## Frontend

### 5. Every mark rewrites the entire collection

`addOwned` → `getPrintings()` → parse all rows → `mergePrintings` → `JSON.stringify` the lot → `localStorage.setItem`. That is O(n) per toggle on the main thread.

Worse, `markWholeCard` calls `toggleOwned` once per printing, so a triple-pinch on a 4-printing card does four full read-merge-write cycles, each re-rendering every subscriber.

**Fix:** a batch mutation that applies many changes in one read-merge-write, plus debounced persistence (write to memory immediately, flush to `localStorage` on idle). Keep the OR-Set semantics exactly as they are — this is about how often the write happens, not what it means.

**Effect:** the only item here that will be _felt_ on a large collection. Worth doing before the collection grows past a few thousand rows.

### 6. Long lists render every row

Ascended Heroes is 295 cards, each with an image and badges. All of them mount.

**Fix:** windowing. On the glasses only ~5 rows are visible, so this is a large saving; do it there first.

### 7. Images are unoptimised

Thumbnails load at full size with no `loading="lazy"`, no `decoding="async"`, no width/height hints, so the browser also has no layout box until each lands.

**Fix:** all three attributes. Cheap, and the biggest byte saving available on a tethered connection.

### 8. Provider recomputes on every collection change

`LibraryProvider` rebuilds a Map, three count objects and a totals pass whenever `collection` changes — fine at 93 rows, quadratic-feeling at 20,000 when combined with item 5.

**Fix:** derive counts incrementally in the same batch mutation as item 5, rather than recomputing from scratch.

### 9. Zod ships to the browser

Schemas validate pokemontcg.io responses client-side, but the proxy now sits in front and can validate once, on the server.

**Fix:** validate at the proxy and drop zod from the client bundle. Keep client validation for the direct-fallback path, or accept that the fallback is best-effort.

**Effect:** meaningful slice of the 55 KB gzip vendor bundle. Do this last — it trades a real safety property for size.

---

## Order

1. **Item 1** — one-line-ish, halves set-view requests
2. **Item 5** — the only user-visible slowdown coming
3. **Item 7** — cheap, helps the tethered device most
4. **Item 2** — removes upstream dependence for the common path
5. **Item 6** — needed once sets of 300 cards are routine
6. Items 3, 4, 8, 9 as cleanup

## What NOT to do

- **Do not cache more aggressively without version keys.** Adding a field to a mapped shape silently serves stale data for the whole TTL; `caches.ts` carries version suffixes for exactly this reason.
- **Do not batch away the local-first write.** The write to memory must stay synchronous, or a mark can be lost on a device that closes immediately — the property the whole sync design rests on.

---

## Proposed: a task-shaped API on the server

The idea: the server becomes the app's only backend, exposing endpoints named
for what the app wants (`get-collection`, `update-collection`,
`retrieve-set-information`) rather than mirroring upstream APIs, and holding
whatever it needs to answer them.

### Worth doing: one endpoint per screen

`GET /api/set-information/:setId` returning **cards + printings + totals in one
payload** collapses the three requests a set view currently makes — rarity
filtered cards, unfiltered cards for the denominator, and printings — into one.
It fixes items 1 and 3 outright, and the server is already the only place that
holds both halves.

Collection is effectively this shape already: `GET /api/collection` and
`POST /api/collection/merge`. Renaming them buys nothing; the merge semantics
are the interesting part and they are right.

**The rule that matters:** endpoints should be shaped by what a screen needs,
not by what upstream happens to expose. That is what removes round trips.

### Not worth doing: proxying card images

Storing card art on the server and serving it back would very likely be
**slower, not faster**.

- Images already come from a CDN built to serve them. The home server is on a
  residential connection, and its upload is the bottleneck for every device.
- The glasses do not reach it over the LAN — they go out to the internet and
  back through the Funnel relay, so there is no local-network shortcut to win.
- Volume is real: a 300-card set is roughly 10-25 MB of thumbnails, so caching
  a meaningful slice of the catalog is gigabytes.
- It makes the box a hard dependency for _visible_ content. Today a server
  outage costs sync and printings; then it would blank every card image, which
  is the most obvious possible failure.

**If the goal is offline use, cache on the device, not the server** — a service
worker caching image responses gives genuinely offline art with no upstream
cost and no new dependency.

### The constraint any of this must respect

The app currently degrades when the server is off: the catalog falls back to
the public API. A full backend-for-frontend removes that unless the fallback is
kept deliberately. Given how much of this week that machine spent powered off,
**the fallback is not optional** — every new aggregate endpoint needs a
client-side path that still works without it, even if slower.

## How to tell if it worked

No profiling has been done. Before optimising, capture: time from set-row select to first card row painted, request count per set view (DevTools, glasses-sized viewport), and `localStorage` write duration at 5,000 rows. Otherwise items 5, 6 and 8 are theory.
