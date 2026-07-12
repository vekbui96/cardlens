# Pricing normalization

CardLens shows **raw English market pricing** for the MVP. We never mix finishes, never mix
raw/graded, never mix currencies, and never display an unavailable price as `$0.00` — we show
**`Unavailable`**.

## Source shape (pokemontcg.io → TCGplayer, verified live)

```jsonc
"tcgplayer": {
  "url": "https://prices.pokemontcg.io/tcgplayer/<id>",
  "updatedAt": "2026/07/11",              // YYYY/MM/DD string
  "prices": {
    "holofoil":        { "low": 77.68, "mid": 135.45, "high": 1999.96, "market": 68.3,  "directLow": null },
    "reverseHolofoil": { "low": 41.0,  "mid": 45.95,  "high": 443.3,   "market": 54.75, "directLow": null }
    // any subset of: normal, holofoil, reverseHolofoil, 1stEdition, 1stEditionHolofoil, unlimited, ...
  }
}
```

Notes that drive the normalizer:

- Finish keys are **present only if the card was printed in that finish** — iterate keys, never
  assume `normal` exists.
- `market` is the headline number. `directLow` is often `null`.
- `updatedAt` is `YYYY/MM/DD`, not ISO — normalized to ISO for display.

## Normalized model

```ts
interface CardPriceResult {
  currency: string; // "USD"
  marketPrice?: number; // headline finish market
  lowPrice?: number;
  midPrice?: number;
  highPrice?: number;
  directLowPrice?: number;
  lastUpdated: string; // ISO 8601, from source updatedAt
  source: string; // "TCGplayer (via pokemontcg.io)"
  variants: {
    normal?: VariantPrice;
    holofoil?: VariantPrice;
    reverseHolofoil?: VariantPrice;
    firstEditionHolofoil?: VariantPrice;
    firstEditionNormal?: VariantPrice;
  };
}
interface VariantPrice {
  market?: number;
  low?: number;
  mid?: number;
  high?: number;
}
```

## Rules (`integrations/pricing/normalize.ts`)

1. Map source finish keys → model variant keys:
   `normal→normal`, `holofoil→holofoil`, `reverseHolofoil→reverseHolofoil`,
   `1stEditionHolofoil→firstEditionHolofoil`, `1stEdition→firstEditionNormal`.
2. Choose a **headline finish** deterministically: prefer `holofoil`, then `normal`, then
   `reverseHolofoil`, then the first available. The headline's `market/low/mid/high` populate the
   top-level fields. The UI shows which finish the headline represents.
3. Treat `0`, `null`, `undefined`, and `NaN` as **absent** → rendered `Unavailable` (never `$0.00`).
4. `lastUpdated` = ISO from `updatedAt`; the UI shows a relative "updated" time and flags the value
   **stale** if older than the price-cache TTL.
5. `source` names TCGplayer explicitly; the card links out via `tcgplayer.url`. We describe these as
   **market/listing-derived** prices, **not completed sales**.

Empty/edge cases are unit-tested: no `tcgplayer` object, empty `prices`, all-zero values, a single
finish, and multiple finishes (headline selection).

## Currency & scope

- MVP: **USD** from TCGplayer only. Cardmarket (EUR) is parsed-capable but not surfaced, to avoid
  mixing currencies on the small display.
- Graded, Japanese, sealed, and completed-sales pricing are explicitly out of scope.
