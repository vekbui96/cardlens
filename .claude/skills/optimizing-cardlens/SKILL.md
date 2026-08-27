---
name: optimizing-cardlens
description: Use when asked to optimize, speed up, or improve the performance of CardLens or one of its screens — "optimize the homepage", "the app feels slow", "make it load faster", "reduce requests" — or before changing anything for performance reasons.
---

# Optimizing CardLens

**Measure the running app first. Every time.** This codebase is unusually well
commented, and the comments describe intent, not current behaviour. Reading them
will give you a confident, wrong answer about where the time goes.

The proof: `useCatalogPrices` carried the comment _"Costs nothing extra: the
queryKey is the one the set screen's unfiltered card list already uses, so these
resolve from cache whenever a set has been opened."_ That was true when written.
By the time anyone looked, the set screen had moved to `/api/set-information`,
Home had started pricing the whole collection, and the hook was firing nineteen
uncached 250-card requests at 4.5–6.7 seconds each. **The comment was the reason
nobody looked.**

## 1. Load the real page and read its timings

Not the dev server — the deployed site, on the connection real devices use.

```js
// In the browser, on https://vekbui96.github.io/cardlens/
const res = performance.getEntriesByType("resource");
const byOrigin = {};
for (const r of res) {
  const o = new URL(r.name).origin;
  (byOrigin[o] ??= []).push(Math.round(r.duration));
}
// Slowest first — this is the list that decides what to work on.
res
  .map((r) => ({ u: r.name.slice(-70), d: Math.round(r.duration), t: Math.round(r.startTime) }))
  .sort((a, b) => b.d - a.d)
  .slice(0, 15);
```

Read the **console** too. The first pass on Home found twelve CORS and 500
errors against `api.pokemontcg.io` that no screen surfaced — the proxy was
failing and the direct fallback was failing behind it, invisibly.

Three things to look for, in this order:

1. **Request count per origin.** Home was making 44 calls to the home server.
   A count that scales with collection size is a batching bug, not a slow server.
2. **Duration.** Anything over a second against `server-pc.tail0e4194.ts.net` is
   either uncached upstream work or bytes — check which before assuming.
3. **Start time clustering.** Everything starting at the same millisecond means
   one waterfall stage; a second cluster 300ms later means a serialised
   dependency worth breaking.

## 2. Know which numbers are real

Timings against the home server vary wildly, because it is a residential uplink
behind a Tailscale Funnel. **One sample is noise.** Measured on one endpoint in
one session: 3018ms, then 219, 196, 211, 213.

Take a median of five, and separate the three cases, which differ by 50x:

```js
// network round trip (cache-busted) vs browser-cached revisit
await fetch(`${url}&cb=${performance.now()}`); // ~213ms median
await fetch(url); // ~4ms, served from Cache-Control
```

The first request of a session also pays ~350ms of TLS handshake to that host.
Subtract it before concluding a payload is slow — `time_appconnect` in
`curl -w` gives it to you.

## 3. The three levers, in the order they usually pay

**Payload shape beats everything.** Ask what the screen actually consumes.
Home needed `cardId -> price` and was being sent full card summaries — name,
artist, rarity, images, the whole embedded set object — 250 cards at a time,
and discarding all of it. `select=id,tcgplayer` was a fiftieth of the bytes.

**Then cache lifetime.** The catalog proxy's TTL is **60 seconds**, which is
right for a card lookup and absurd for market prices that move daily. Anything
Home reads on every visit wants a server-side disk cache with a real TTL —
`server/catalogPrices.ts` and `server/printingsStore.ts` are the pattern:
per-key file, version field, in-flight coalescing, and **serve stale rather than
fail**, because upstream fails ~25% of the time in bursts.

**Then bytes on the wire.** `compression()` is now mounted, so this is largely
paid; check `content-encoding` before assuming it applies to a new route.

Only after those: bundle splitting. It is already thorough, and the wins are
tens of milliseconds against seconds elsewhere.

## 4. Rules that come from getting this wrong here

- **Partial success, always.** One set that cannot be priced must not cost the
  other eighteen their numbers. Return what you have and name what is missing —
  Home can say "480 of 973 printings priced", but it can say nothing at all from
  an empty body.
- **Never cache an empty result.** Empty is legitimate (pokemontcg.io prices
  0/120 Pitch Black) and indistinguishable from a malformed response. Caching it
  strands the set for the whole TTL.
- **A new endpoint needs the old path behind `enabled`.** Pages and the server
  deploy separately, so a client shipped against a server that has not caught up
  is normal, not a fault. Without a fallback the collection reads as worth
  nothing for the length of that window.
- **Shared keys must come from shared code.** Server and device both key prices
  `<cardId>|<priceKey>` through the same `normalizeTcgplayerPricing`. A second
  copy of that mapping drifts, and the symptom is silent: a collection that
  simply prices lower than it should.
- **Zero is not absent.** A stored `0` sums into the collection total as though
  the printing were worthless, and reads on screen as a real answer.

## 5. Prove it, on the deployed site

`npm run verify` passing is not evidence of a speed-up, and **a blank SPA
returns 200**. Load the page, re-run the step-1 script, and compare against the
numbers you wrote down before. State the before and after together:

> 19 requests at 4.5–6.7s each, several failing, ~18s to settle
> → 1 request, 213ms median, 4ms on revisit.

If you cannot state it that way, you have not measured it.

## Where the bodies are

- `useCatalogPrices` / `useCollectionValue` / `useLibraryValue` — the Home value
  path, and the one that scales with collection size
- `server/index.ts` `loadCatalog` — retry policy and the 60s `proxyCache`
- `src/storage/caches.ts` — device-side TTL caches, and a **~5MB localStorage
  budget this app has already exhausted once**. Do not spend it on data that
  refetches in a second; the collection cannot be rebuilt at all and wins every
  argument for space.
