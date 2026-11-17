# Data sources and pricing

Moved out of CLAUDE.md; read when touching the catalog proxy, printings, or prices.

## pokemontcg.io — the catalog, and unreliable

- **Fails ~25% of the time, in bursts.** Measured: 3/12 identical requests returned 500; failures cluster in time rather than being independent, so tight retries land inside the same burst and all fail. The server proxy retries across ~4s for this reason.
- **Reports no variant data at all for some sets.** Pitch Black (`me5`) returns `prices: {}` for all 120 cards.
- **Never reports pattern foils** — no Poké Ball, Master Ball, energy, or ball-type reverses, in any set.
- 403s the default Python `urllib` user-agent. Set one when scripting.

## TCGdex — the printings oracle

- Free, no key. Used **only** to answer "which printings does this card have".
- **Variants exist only on the individual card endpoint.** The set endpoint's embedded cards carry `id, image, localId, name`, and `/cards?set=` returns the same brief shape. A set-wide answer therefore costs one request per card: 120 for Pitch Black, 295 for Ascended Heroes.
- Measured at concurrency 6: 120 cards in 1.3s / 0.28MB, 173 in 1.8s / 0.46MB, zero failures.
- Set ids differ from pokemontcg.io (`me5` vs `me05`, `sv8pt5` vs `sv08.5`), so matching is **by normalised name**: 167/174 sets join, and card numbers then resolve to `localId` for 1183/1184 sampled cards. Numbers are indexed both padded and unpadded to bridge the two.
- **`variantId: "generated"` means TCGdex invented the variant** and it carries no information. Whole older sets are like this — measured, all 69 Hidden Fates and all 196 Team Up cards report one made-up `normal` printing while the only tcgplayer key is `holofoil`. Matching the price key against that placeholder type silently dropped prices for 12/69 and 45/196 cards, the expensive ones. A lone generated variant now takes a lone market price; two prices stays unpriced. Modern sets (me05) are never generated and are unaffected.
- Price keys observed across 526 fully-measured cards: `normal`, `holofoil`, `reverse-holofoil`, and nothing else. `1st-edition-holofoil` never appears — 1st Edition rides as a `stamp` on a `holo` variant with `pricing: null`.

**The server caches printings** (`/api/printings/:setId`) so devices make one 8KB request instead of 120 requests and 280KB.

## Home prices the WHOLE collection, so pricing is batched and cached hard

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
