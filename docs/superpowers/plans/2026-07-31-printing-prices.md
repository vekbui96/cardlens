# Per-Printing Prices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TCGdex per-printing prices readable at the card and printing level, so a card in a set pokemontcg.io does not price stops showing `Unavailable`.

**Architecture:** The prices already arrive — `TcgdexClient.toPrintings` attaches a `price` to each `Printing`, and `useCollectionValue` reads them straight off the raw `byNumber` map. They are lost at exactly one place: `buildPrintingIndex` maps `Printing[]` to `Finish[]`, discarding everything but the key. This plan carries prices through that index, exposes them on `SetView`, and uses them as the headline when the catalog has no price. It then widens TCGdex price-key coverage and deletes the duplicated lookup in `useCollectionValue`.

**Tech Stack:** TypeScript, React, TanStack Query, Vitest, Zod.

## Global Constraints

- **Commit messages are sentence-case imperative with no prefix.** Match the log: `Price the collection per printing, from TCGdex`. Never `feat:` / `fix:`.
- **Run `npm run verify` before every commit** — it is `format:check + typecheck + lint + test`, the same set CI runs. `format:check` was once missing here and script-applied edits passed locally then failed the deploy.
- **Prettier is enforced by CI.** After any bulk/scripted edit run `npm run format`.
- **Never render an absent price as `$0.00`.** `formatUsd` already returns `"Unavailable"` for `undefined`, `null`, non-finite and `<= 0`. Absent means unknown.
- **Never store `0` as a real price.** Treat it as absent at every layer.
- **Do not invent prices for pattern foils.** TCGdex publishes no separate key for `reverse:pokeball` and friends; giving them the plain `reverse` price would fabricate a number.
- `src/integrations/tcgdex/client.ts` is compiled into the **server** (see `tsconfig.node.json`) and imported by `server/printingsStore.ts`. Changing it means deploying the server, not just Pages.
- **`Finish` is a plain `string`** (`type` or `type:foil`). Never narrow it to an enum — sets invent foils.

---

## Shared Interface Contract

> This block is duplicated verbatim in `2026-07-31-mobile-web-ui.md`. That plan's Task 1 consumes it. **Do not change these names or signatures without updating both plans.**

After Task 2 of this plan, the following exist:

```ts
// src/models/printingIndex.ts
export interface SetPrintingIndex {
  byNumber: Record<string, Finish[]>;
  all: Finish[];
  packTotal: number;
  excluded: { finish: Finish; cards: number }[];
  /** `<collectorNumber>|<finish>` -> USD market price. Only priced printings appear. */
  prices: Record<string, number>;
}

/** Price for one printing, trying both padded and unpadded number forms. */
export function printingPrice(
  index: SetPrintingIndex | null | undefined,
  collectorNumber: string,
  finish: Finish,
): number | undefined;
```

```ts
// src/hooks/useSetView.ts — added to the SetView interface
export interface SetView {
  // ...existing members unchanged...
  /** USD market price for one printing of one card, or undefined when unpriced. */
  priceFor: (collectorNumber: string, finish: Finish) => number | undefined;
  /** Best single price to headline a card: catalog price, else the dearest known printing. */
  headlinePriceFor: (card: PokemonCardSummary) => number | undefined;
}
```

---

### Task 1: Carry prices through the printing index

**Files:**

- Modify: `src/models/printingIndex.ts:1-57`
- Test: `src/models/printingIndex.test.ts`

**Interfaces:**

- Consumes: `Printing` from `src/integrations/tcgdex/client.ts` (already has optional `price?: number`).
- Produces: `SetPrintingIndex.prices` and `printingPrice()` exactly as in the Shared Interface Contract above.

- [ ] **Step 1: Write the failing tests**

Add to `src/models/printingIndex.test.ts`:

```ts
describe("printingPrice", () => {
  it("indexes a price per number and finish", () => {
    const index = buildPrintingIndex({
      "001": [
        { type: "normal", price: 1.5 },
        { type: "reverse", price: 4.25 },
      ],
    });

    expect(printingPrice(index, "001", "normal")).toBe(1.5);
    expect(printingPrice(index, "001", "reverse")).toBe(4.25);
  });

  it("resolves an unpadded number against a padded key", () => {
    // TCGdex pads modern sets; pokemontcg.io does not. Both forms must answer.
    const index = buildPrintingIndex({ "007": [{ type: "normal", price: 2 }] });

    expect(printingPrice(index, "7", "normal")).toBe(2);
  });

  it("reports an unpriced printing as undefined rather than zero", () => {
    // A pattern foil has no upstream price. Zero would total up as worthless
    // rather than unknown.
    const index = buildPrintingIndex({
      "001": [{ type: "reverse", foil: "pokeball" }],
    });

    expect(printingPrice(index, "001", "reverse:pokeball")).toBeUndefined();
  });

  it("returns undefined for a missing index or unknown card", () => {
    expect(printingPrice(null, "001", "normal")).toBeUndefined();
    expect(printingPrice(buildPrintingIndex({}), "999", "normal")).toBeUndefined();
  });
});
```

Add `printingPrice` to the existing import at the top of the file:

```ts
import { buildPrintingIndex, printingPrice } from "./printingIndex.ts";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/models/printingIndex.test.ts`
Expected: FAIL — `printingPrice is not a function`.

- [ ] **Step 3: Implement**

In `src/models/printingIndex.ts`, add `prices` to the interface:

```ts
export interface SetPrintingIndex {
  /** Collector number -> the printings that card exists in. */
  byNumber: Record<string, Finish[]>;
  /** Every printing seen in the set, ordered for pickers. */
  all: Finish[];
  /**
   * Total printings counted toward completion — the master-set denominator
   * under the rule "if you can pull it from a standard pack it counts".
   */
  packTotal: number;
  /** Printings excluded as product exclusives, with the card counts that got them excluded. */
  excluded: { finish: Finish; cards: number }[];
  /**
   * `<collectorNumber>|<finish>` -> USD market price.
   *
   * Only priced printings appear, so a missing key means "unknown" rather than
   * "free". Kept as a flat record rather than a method so the index stays plain
   * data and can be compared and snapshotted in tests.
   */
  prices: Record<string, number>;
}
```

Inside `buildPrintingIndex`, declare the map alongside `byNumber` and fill it in the same loop:

```ts
const byNumber: Record<string, Finish[]> = {};
const prices: Record<string, number> = {};
```

Replace the body of the `for (const [number, printings] of ...)` loop's first two lines with:

```ts
const finishes = printings.map((p) => makeFinish(p.type, p.foil));
byNumber[number] = finishes;
for (const p of printings) {
  // Zero is not a price. Absent means unknown, and a 0 would sum as if the
  // printing were worthless.
  if (typeof p.price === "number" && Number.isFinite(p.price) && p.price > 0) {
    prices[`${number}|${makeFinish(p.type, p.foil)}`] = p.price;
  }
}
```

Return it:

```ts
return { byNumber, all, packTotal, excluded, prices };
```

Then append the lookup helper at the end of the file:

```ts
/** Strip leading zeros from a collector number: "007" -> "7", "001a" -> "1a". */
function unpadded(collectorNumber: string): string {
  return collectorNumber.replace(/^0+(?=\d)/, "");
}

/**
 * Price for one printing of one card.
 *
 * Tries the number as given and then unpadded, because TCGdex pads modern sets
 * while pokemontcg.io does not and either form can reach here. This lookup was
 * previously inlined in useCollectionValue; it lives here so the set screen and
 * the collection total cannot disagree about what a printing is worth.
 */
export function printingPrice(
  index: SetPrintingIndex | null | undefined,
  collectorNumber: string,
  finish: Finish,
): number | undefined {
  if (!index) return undefined;
  return (
    index.prices[`${collectorNumber}|${finish}`] ?? index.prices[`${unpadded(collectorNumber)}|${finish}`]
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/models/printingIndex.test.ts`
Expected: PASS, including the pre-existing `buildPrintingIndex` tests.

- [ ] **Step 5: Commit**

```bash
git add src/models/printingIndex.ts src/models/printingIndex.test.ts
git commit -m "Keep per-printing prices in the set printing index"
```

---

### Task 2: Expose prices on SetView

**Files:**

- Modify: `src/hooks/useSetView.ts:1-120`
- Test: `src/hooks/useSetView.test.ts` (create)

**Interfaces:**

- Consumes: `printingPrice`, `SetPrintingIndex.prices` from Task 1.
- Produces: `SetView.priceFor` and `SetView.headlinePriceFor` exactly as in the Shared Interface Contract.

- [ ] **Step 1: Write the failing test**

Create `src/hooks/useSetView.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildPrintingIndex } from "../models/printingIndex.ts";
import { headlinePrice } from "./useSetView.ts";
import type { PokemonCardSummary } from "../models/cards.ts";

function card(over: Partial<PokemonCardSummary> = {}): PokemonCardSummary {
  return {
    id: "me5-007",
    name: "Test Card",
    collectorNumber: "007",
    imageSmall: "",
    ...over,
  } as PokemonCardSummary;
}

describe("headlinePrice", () => {
  it("prefers the catalog price when there is one", () => {
    // pokemontcg.io priced this card; that is the number the rest of the app
    // already sorts and displays by, so it stays authoritative.
    const index = buildPrintingIndex({ "007": [{ type: "normal", price: 99 }] });

    expect(headlinePrice(card({ marketPrice: 12 }), index)).toBe(12);
  });

  it("falls back to the dearest known printing when the catalog has none", () => {
    // Measured live: pokemontcg.io returns pricing for 0/120 Pitch Black cards.
    // Without this the whole set reads "Unavailable" despite TCGdex pricing it.
    const index = buildPrintingIndex({
      "007": [
        { type: "normal", price: 1.5 },
        { type: "reverse", price: 4.25 },
      ],
    });

    expect(headlinePrice(card({ marketPrice: undefined }), index)).toBe(4.25);
  });

  it("returns undefined when nothing prices the card", () => {
    const index = buildPrintingIndex({ "007": [{ type: "reverse", foil: "pokeball" }] });

    expect(headlinePrice(card({ marketPrice: undefined }), index)).toBeUndefined();
  });

  it("treats a zero catalog price as absent", () => {
    const index = buildPrintingIndex({ "007": [{ type: "normal", price: 3 }] });

    expect(headlinePrice(card({ marketPrice: 0 }), index)).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/hooks/useSetView.test.ts`
Expected: FAIL — `headlinePrice` is not exported.

- [ ] **Step 3: Implement**

In `src/hooks/useSetView.ts`, extend the imports:

```ts
import { printingPrice, type SetPrintingIndex } from "../models/printingIndex.ts";
import type { Finish } from "../models/finishes.ts";
```

(The existing `import type { SetPrintingIndex }` line is replaced by the one above.)

Add the exported pure function above `useSetView` so it is testable without a React renderer:

```ts
/**
 * The single price to headline a card with.
 *
 * The catalog price wins when present: it is what search results already sort
 * by, and two different headline numbers for one card would be worse than a
 * missing one. Otherwise the dearest known printing stands in — measured live,
 * pokemontcg.io prices 0/120 Pitch Black and 0/124 Perfect Order cards while
 * TCGdex prices both, so without this whole sets read "Unavailable".
 *
 * Dearest rather than cheapest because the headline answers "what is this card
 * worth", and a collector reads that as the good copy.
 */
export function headlinePrice(
  card: PokemonCardSummary,
  index: SetPrintingIndex | null | undefined,
): number | undefined {
  const catalog = card.marketPrice;
  if (typeof catalog === "number" && Number.isFinite(catalog) && catalog > 0) return catalog;

  const finishes = index?.byNumber[card.collectorNumber] ?? [];
  let best: number | undefined;
  for (const finish of finishes) {
    const price = printingPrice(index, card.collectorNumber, finish);
    if (price !== undefined && (best === undefined || price > best)) best = price;
  }
  return best;
}
```

Add both members to the `SetView` interface, after `finishesFor`:

```ts
/** USD market price for one printing of one card, or undefined when unpriced. */
priceFor: (collectorNumber: string, finish: Finish) => number | undefined;
/** Best single price to headline a card: catalog price, else the dearest known printing. */
headlinePriceFor: (card: PokemonCardSummary) => number | undefined;
```

Inside the hook, after the existing `finishesFor` memo:

```ts
const priceFor = useMemo(() => {
  return (collectorNumber: string, finish: Finish) => printingPrice(printings, collectorNumber, finish);
}, [printings]);

const headlinePriceFor = useMemo(() => {
  return (card: PokemonCardSummary) => headlinePrice(card, printings);
}, [printings]);
```

And add both to the returned object, after `finishesFor,`:

```ts
    priceFor,
    headlinePriceFor,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/hooks/useSetView.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify nothing else broke**

Run: `npm run verify`
Expected: all pass. `SetCardsScreen.test.tsx` and `WebSetCardsScreen.test.tsx` build `SetView`-shaped objects; if either constructs one literally, add `priceFor: () => undefined` and `headlinePriceFor: () => undefined` to the fixture.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useSetView.ts src/hooks/useSetView.test.ts
git commit -m "Expose per-printing and headline prices on the set view"
```

> **At this point the Shared Interface Contract is satisfied. `2026-07-31-mobile-web-ui.md` Task 1 is unblocked and the two plans can proceed in parallel.**

---

### Task 3: Use the headline price wherever a card price is shown

**Files:**

- Modify: `src/web/sets/WebSetCardsScreen.tsx:132-140`
- Modify: `src/web/sets/CardSheet.tsx:20-68`
- Test: `src/web/sets/WebSetCardsScreen.test.tsx`

**Interfaces:**

- Consumes: `SetView.headlinePriceFor` from Task 2.
- Produces: `CardSheet` accepts a new required prop `headlinePrice?: number`.

> **Coordination note:** `2026-07-31-mobile-web-ui.md` Task 1 also edits `CardSheet.tsx`, adding a `priceFor` prop and per-printing rows. The two changes are compatible — this one replaces the `card.marketPrice` reference in the header, that one adds prices to the printing list — but **they will conflict textually.** Whichever lands second rebases. If both plans run at once, prefer letting the mobile-UI plan own `CardSheet.tsx` entirely and reduce this task to the `WebSetCardsScreen` wiring plus passing the prop down.

- [ ] **Step 1: Write the failing test**

Add to `src/web/sets/WebSetCardsScreen.test.tsx`:

```ts
it("headlines a card with its dearest printing when the catalog has no price", async () => {
  // Pitch Black returns prices: {} for all 120 cards, so the catalog price is
  // absent and the sheet used to read "Unavailable" on a card TCGdex prices.
  renderScreen({
    cards: [{ id: "me5-007", name: "Test Card", collectorNumber: "007", marketPrice: undefined }],
    printings: {
      "007": [
        { type: "normal", price: 1.5 },
        { type: "reverse", price: 4.25 },
      ],
    },
  });

  await userEvent.click(await screen.findByRole("button", { name: /Test Card/ }));

  expect(await screen.findByText("$4.25")).toBeInTheDocument();
});
```

Match the file's existing render helper and mocking style rather than introducing a new one — read the top of the file first and reuse whatever `renderScreen` equivalent is already there.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/web/sets/WebSetCardsScreen.test.tsx`
Expected: FAIL — renders `Unavailable` instead of `$4.25`.

- [ ] **Step 3: Implement**

In `src/web/sets/CardSheet.tsx`, add the prop to the signature:

```ts
export function CardSheet({
  card,
  finishes,
  owned,
  headlinePrice,
  onToggle,
  onClose,
}: {
  card: PokemonCardSummary;
  finishes: CollectFinish[];
  owned: CollectFinish[];
  /** Resolved by the caller from SetView.headlinePriceFor — the catalog price is not always the best one. */
  headlinePrice?: number;
  onToggle: (finish: CollectFinish) => void;
  onClose: () => void;
}) {
```

Replace the price line:

```tsx
<p className={styles.price}>{formatUsd(headlinePrice ?? card.marketPrice)}</p>
```

In `src/web/sets/WebSetCardsScreen.tsx`, pass it:

```tsx
<CardSheet
  card={openCard}
  finishes={view.finishesFor(openCard.collectorNumber, openCard.variants)}
  owned={ownedFinishes(openCard.id)}
  headlinePrice={view.headlinePriceFor(openCard)}
  onToggle={(finish: CollectFinish) => toggleOwned(openCard.id, finish, setId)}
  onClose={() => setOpenCardId(null)}
/>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/web/sets/WebSetCardsScreen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/sets/CardSheet.tsx src/web/sets/WebSetCardsScreen.tsx src/web/sets/WebSetCardsScreen.test.tsx
git commit -m "Headline a card with its dearest printing when the catalog cannot price it"
```

---

### Task 4: Widen TCGdex price-key coverage, measured not guessed

**Files:**

- Modify: `src/integrations/tcgdex/client.ts:186-204`
- Modify: `server/printingsStore.ts:31`
- Test: `src/integrations/tcgdex/client.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: no new exports. Widens `PRICE_KEY_TO_TYPE` and bumps `PRINTINGS_CACHE_VERSION` to `3`.

**Why measurement first:** `PRICE_KEY_TO_TYPE` currently maps three keys. The comment above it records that the counts were verified against live me05/me03 cards. Any addition must be verified the same way — a wrong mapping produces a confidently wrong price, which is worse than `Unavailable`.

- [ ] **Step 1: Measure what keys TCGdex actually publishes**

Run this against the live API and read the output before writing any mapping:

```bash
node -e "
const sets = ['me05','me03','sv08.5','base1'];
(async () => {
  const keys = new Map();
  for (const setId of sets) {
    const set = await (await fetch('https://api.tcgdex.net/v2/en/sets/' + setId)).json();
    for (const brief of (set.cards ?? []).slice(0, 40)) {
      const card = await (await fetch('https://api.tcgdex.net/v2/en/cards/' + brief.id)).json();
      for (const k of Object.keys(card.pricing?.tcgplayer ?? {})) {
        keys.set(k, (keys.get(k) ?? 0) + 1);
      }
    }
  }
  console.log([...keys.entries()].sort((a, b) => b[1] - a[1]));
})();
"
```

Record the result in the commit message. Keys already mapped: `normal`, `holofoil`, `reverse-holofoil`. Non-price keys such as `unit` and `updated` must stay unmapped.

- [ ] **Step 2: Write the failing test**

Add to `src/integrations/tcgdex/client.test.ts`, using only keys the measurement in Step 1 actually returned. If Step 1 shows `1st-edition-holofoil` exists, this test is correct as written; if it does not, drop that case rather than mapping a key that never appears:

```ts
it("maps every measured tcgplayer price key onto a printing type", () => {
  const card = {
    id: "base1-4",
    localId: "4",
    variants_detailed: [{ type: "holo" }, { type: "firstEdition" }],
    pricing: {
      tcgplayer: {
        holofoil: { marketPrice: 250 },
        "1st-edition-holofoil": { marketPrice: 4200 },
        unit: "USD",
        updated: "2026-07-31",
      },
    },
  };

  const printings = toPrintings(card);

  expect(printings).toContainEqual({ type: "holo", price: 250 });
  expect(printings).toContainEqual({ type: "firstEdition", price: 4200 });
});

it("skips an unrecognised price key rather than guessing a type", () => {
  // A wrong price is worse than a missing one.
  const card = {
    id: "x-1",
    localId: "1",
    variants_detailed: [{ type: "normal" }],
    pricing: { tcgplayer: { "some-future-foil": { marketPrice: 9 } } },
  };

  expect(toPrintings(card)).toEqual([{ type: "normal" }]);
});
```

`toPrintings` is currently module-private. Export it for the test:

```ts
export function toPrintings(card: TcgdexCard): Printing[] {
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/integrations/tcgdex/client.test.ts`
Expected: FAIL — `1st-edition-holofoil` is unmapped, so `firstEdition` has no price.

- [ ] **Step 4: Implement**

Extend the map in `src/integrations/tcgdex/client.ts`, **adding only keys Step 1 observed**:

```ts
const PRICE_KEY_TO_TYPE: Record<string, string> = {
  normal: "normal",
  holofoil: "holo",
  "reverse-holofoil": "reverse",
  // Added after measuring live keys across me05, me03, sv08.5 and base1 — see
  // the commit message for the counts. Unmeasured keys stay out on purpose.
  "1st-edition-holofoil": "firstEdition",
  "1st-edition": "firstEdition",
};
```

- [ ] **Step 5: Bump the server cache version**

The server holds printings for 30 days and treats them as fresh. New price keys would otherwise be invisible for a month. In `server/printingsStore.ts`:

```ts
/**
 * Bump whenever the cached SHAPE gains something callers read.
 *
 * The TTL alone cannot do this job: entries are held for 30 days and treated as
 * fresh, so adding per-printing prices would have served priceless entries for a
 * month with no way to tell them apart from complete ones. A version mismatch
 * makes them stale immediately.
 *
 * v2 — printings carry a `price`.
 * v3 — first-edition price keys are mapped, so v2 entries under-price old sets.
 */
export const PRINTINGS_CACHE_VERSION = 3;
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run verify`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/integrations/tcgdex/client.ts src/integrations/tcgdex/client.test.ts server/printingsStore.ts
git commit -m "Map first-edition price keys and invalidate the printings cache

Measured across me05, me03, sv08.5 and base1: <paste the key counts from Step 1>."
```

- [ ] **Step 8: Deploy both halves**

`tcgdex/client.ts` is in the server's compile surface, so Pages alone is not enough — and a stale server has silently dropped data before.

```bash
gh workflow run "deploy-pages.yml" --repo vekbui96/cardlens
ssh vebui@192.168.86.41 "powershell -NoProfile -Command \"git -C D:\services\cardlens fetch origin main --quiet; git -C D:\services\cardlens reset --hard origin/main --quiet; Restart-Service cardlens\""
```

Then confirm a v3 entry gets written:

```bash
curl -s "https://server-pc.tail0e4194.ts.net:8443/api/printings/me5?name=Pitch%20Black" | head -c 300
```

---

### Task 5: Delete the duplicated price lookup in useCollectionValue

**Files:**

- Modify: `src/hooks/useCollectionValue.ts:11-23,84-95`
- Test: existing `src/models/printingIndex.test.ts` covers the shared helper.

**Interfaces:**

- Consumes: `buildPrintingIndex`, `printingPrice` from Task 1.
- Produces: no new exports. `indexPrices` and the local `PriceIndex` type are removed.

**Why:** `useCollectionValue` builds its own `<number>|<finish>` map and re-implements the padded/unpadded fallback. That is the same lookup Task 1 put in `printingIndex.ts`. Two copies of a pricing rule that can drift is the same failure mode the collection merge rule was deliberately shared to avoid.

- [ ] **Step 1: Replace the local index with the shared one**

In `src/hooks/useCollectionValue.ts`, delete the `PriceIndex` type and the whole `indexPrices` function (lines 11-23), and replace these imports:

```ts
import { buildPrintingIndex, printingPrice, type SetPrintingIndex } from "../models/printingIndex.ts";
```

Remove the now-unused `makeFinish` import.

Replace the `prices` map construction and the `valueCollection` call body:

```ts
const prices = new Map<string, SetPrintingIndex | null>();
let pending = 0;
let failed = 0;

setIds.forEach((setId, i) => {
  const q = queries[i];
  if (!q) return;
  if (q.isPending) pending += 1;
  if (q.isError) failed += 1;
  prices.set(setId, buildPrintingIndex(q.data?.byNumber));
});

const value = valueCollection(rows, (row) => {
  // Collector number is the tail of the card id — the same join the rest of
  // the app makes, because TCGdex keys printings by number, not by card id.
  const number = row.cardId.slice(row.cardId.indexOf("-") + 1);
  return printingPrice(prices.get(row.setId), number, row.finish);
});
```

- [ ] **Step 2: Verify the totals did not move**

Run: `npm run verify`
Expected: PASS. `useCollectionValue` has no direct test; the guard is that `printingPrice` reproduces both number forms, which Task 1 tested.

Then check a real total against the live collection — it must be unchanged:

```bash
npm run dev
# Open the Collection screen, note the total and the unpriced count.
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useCollectionValue.ts
git commit -m "Value the collection through the shared printing price lookup"
```

---

## Out of scope, deliberately

- **Cardmarket / EUR.** Parsed-capable in the schema but not surfaced. Mixing currencies on a 600x600 additive display is worse than one currency, and `docs/pricing.md` fixes the MVP at USD.
- **Pattern-foil prices.** TCGdex publishes no separate key for them. Task 1's third test pins this as intended behaviour, not a gap.
- **Low/mid/high spreads.** `Printing.price` is a single market number by design; a spread needs UI that does not exist yet.
- **Graded, Japanese, sealed and completed-sales pricing.** Out of scope per `docs/pricing.md`.
