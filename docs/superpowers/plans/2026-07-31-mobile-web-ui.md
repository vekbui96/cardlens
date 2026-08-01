# Mobile Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the phone shell answer "what am I missing and what is it worth" per printing, and prove it actually renders at real phone dimensions rather than the 600x600 square it was built against.

**Architecture:** The grid, the bottom sheet and the missing-only filter already exist and shipped today. Two things do not: the sheet shows one catalog price for the whole card rather than a price per printing, and nothing has ever rendered this shell at 390x844 — `playwright.config.ts` has a single 600x600 project, and `index.html` hardcoded that viewport for months. This plan puts prices on the printing rows, totals what you own of a card, then adds a real phone Playwright project with assertions that fail on the layout faults such a viewport exposes.

**Tech Stack:** TypeScript, React, CSS Modules, Vitest + Testing Library, Playwright.

## Global Constraints

- **Commit messages are sentence-case imperative with no prefix.** Match the log: `Give the phone a card-image grid instead of the glasses list`. Never `feat:` / `fix:`.
- **Run `npm run verify` before every commit** — `format:check + typecheck + lint + test`, the same set CI runs.
- **Prettier is enforced by CI.** After any bulk/scripted edit run `npm run format`.
- **Never render an absent price as `$0.00`.** `formatUsd` returns `"Unavailable"` for absent, non-finite and `<= 0`.
- **Touch targets are 44px minimum.** The printing rows are already built to this; do not regress it.
- **This shell must not use the focus ring.** `useBackableFocus` and `FocusList` preventDefault arrows and Enter, which fights native scrolling. Web components pass `focused={false}` and use real buttons.
- **Detection is by shape, not size:** the glasses are small AND square; a phone is small and tall. Never branch on width alone.
- **e2e runs on in-memory mocks** (`VITE_USE_MOCKS: "true"` in `playwright.config.ts`). `page.route` interception does nothing for catalog data.

---

## Shared Interface Contract

> This block is duplicated verbatim from `2026-07-31-printing-prices.md`. **That plan's Tasks 1-2 must land before this plan's Task 1.** They are small (one model file, one hook) and are the only ordering constraint between the two plans; everything after is parallel.

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

**File ownership:** this plan owns `src/web/sets/CardSheet.tsx`. The pricing plan's Task 3 carries a note deferring to it, and should keep only the `WebSetCardsScreen` wiring if both run at once.

---

### Task 1: Show a price on every printing row

**Files:**

- Modify: `src/web/sets/CardSheet.tsx:20-120`
- Modify: `src/web/sets/CardSheet.module.css`
- Modify: `src/web/sets/WebSetCardsScreen.tsx:132-140`
- Test: `src/web/sets/CardSheet.test.tsx` (create)

**Interfaces:**

- Consumes: `SetView.priceFor` and `SetView.headlinePriceFor` from the Shared Interface Contract.
- Produces: `CardSheet` gains two props — `headlinePrice?: number` and `priceFor: (finish: CollectFinish) => number | undefined`. The caller binds the collector number, so the sheet never has to know it.

**Why per printing:** a reverse holo is routinely worth several times the normal of the same card, and the collection is stored per printing. One price for the card is the wrong unit — it is the same mistake `valueCollection` was written to avoid.

- [ ] **Step 1: Write the failing test**

Create `src/web/sets/CardSheet.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CardSheet } from "./CardSheet.tsx";
import type { PokemonCardSummary } from "../../models/cards.ts";

const card = {
  id: "me5-007",
  name: "Test Card",
  collectorNumber: "007",
  imageSmall: "",
} as PokemonCardSummary;

function renderSheet(over: Partial<Parameters<typeof CardSheet>[0]> = {}) {
  return render(
    <CardSheet
      card={card}
      finishes={["normal", "reverse"]}
      owned={[]}
      headlinePrice={4.25}
      priceFor={(f) => (f === "normal" ? 1.5 : f === "reverse" ? 4.25 : undefined)}
      onToggle={vi.fn()}
      onClose={vi.fn()}
      {...over}
    />,
  );
}

describe("CardSheet prices", () => {
  it("prices each printing separately", () => {
    renderSheet();

    expect(screen.getByRole("button", { name: /Normal/ })).toHaveTextContent("$1.50");
    expect(screen.getByRole("button", { name: /Reverse Holo/ })).toHaveTextContent("$4.25");
  });

  it("shows Unavailable rather than $0.00 for an unpriced printing", () => {
    // Pattern foils have no upstream price. Zero would read as worthless.
    renderSheet({
      finishes: ["reverse:pokeball"],
      priceFor: () => undefined,
    });

    expect(screen.getByRole("button", { name: /Poké Ball Reverse/ })).toHaveTextContent("Unavailable");
  });

  it("totals only the printings actually owned", () => {
    renderSheet({ owned: ["reverse"] });

    expect(screen.getByTestId("sheet-owned-value")).toHaveTextContent("$4.25");
  });

  it("reports nothing owned as no value rather than zero dollars", () => {
    renderSheet({ owned: [] });

    expect(screen.queryByTestId("sheet-owned-value")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/web/sets/CardSheet.test.tsx`
Expected: FAIL — `priceFor` is not a prop and no price renders on the rows.

- [ ] **Step 3: Implement the sheet**

In `src/web/sets/CardSheet.tsx`, replace the component signature:

```tsx
export function CardSheet({
  card,
  finishes,
  owned,
  headlinePrice,
  priceFor,
  onToggle,
  onClose,
}: {
  card: PokemonCardSummary;
  finishes: CollectFinish[];
  owned: CollectFinish[];
  /** Resolved by the caller from SetView.headlinePriceFor — the catalog price is not always the best one. */
  headlinePrice?: number;
  /** Price for one printing of THIS card. The caller binds the collector number. */
  priceFor: (finish: CollectFinish) => number | undefined;
  onToggle: (finish: CollectFinish) => void;
  onClose: () => void;
}) {
```

Replace the header price line:

```tsx
<p className={styles.price}>{formatUsd(headlinePrice ?? card.marketPrice)}</p>
```

Add the owned total just above the `<ul className={styles.printings}>`, inside the sheet:

```tsx
{
  /* Only what is actually held, and only when something priced is held:
            a "$0.00" line under an empty collection reads as a valuation, not
            as an absence. */
}
{
  ownedValue !== undefined ? (
    <p className={styles.ownedValue} data-testid="sheet-owned-value">
      You own {formatUsd(ownedValue)}
    </p>
  ) : null;
}
```

Compute it at the top of the component body, before the `useEffect`:

```tsx
const ownedValue = useMemo(() => {
  let total: number | undefined;
  for (const finish of owned) {
    const price = priceFor(finish);
    if (price === undefined) continue;
    total = (total ?? 0) + price;
  }
  return total;
}, [owned, priceFor]);
```

Add `useMemo` to the React import:

```tsx
import { useEffect, useMemo, useRef } from "react";
```

Give each printing row its price. Replace the button's children in the **first** `<ul className={styles.printings}>` map:

```tsx
<button
  type="button"
  className={`${styles.printing} ${held ? styles.held : ""}`}
  aria-pressed={held}
  onClick={() => onToggle(finish)}
>
  <span className={styles.box} aria-hidden="true">
    {held ? "✓" : ""}
  </span>
  <span className={styles.printingLabel}>{finishLabel(finish)}</span>
  <span className={styles.printingPrice}>{formatUsd(priceFor(finish))}</span>
</button>
```

Do the same for the second list (the hand-marked extras), which uses the same row shape:

```tsx
                    <span className={styles.printingLabel}>{finishLabel(finish)}</span>
                    <span className={styles.printingPrice}>{formatUsd(priceFor(finish))}</span>
```

- [ ] **Step 4: Style the new elements**

In `src/web/sets/CardSheet.module.css`, add:

```css
/* Pushed to the trailing edge so the labels stay left-aligned and scannable
   down the column; the price is the secondary read. */
.printingPrice {
  margin-left: auto;
  padding-left: 0.75rem;
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
  white-space: nowrap;
}

.ownedValue {
  margin: 0 0 0.5rem;
  font-variant-numeric: tabular-nums;
  opacity: 0.85;
}
```

Confirm `.printing` is already `display: flex; align-items: center;` — `margin-left: auto` depends on it. If it is not, add both to `.printing` rather than changing the layout model.

- [ ] **Step 5: Wire the caller**

In `src/web/sets/WebSetCardsScreen.tsx`:

```tsx
<CardSheet
  card={openCard}
  finishes={view.finishesFor(openCard.collectorNumber, openCard.variants)}
  owned={ownedFinishes(openCard.id)}
  headlinePrice={view.headlinePriceFor(openCard)}
  priceFor={(finish) => view.priceFor(openCard.collectorNumber, finish)}
  onToggle={(finish: CollectFinish) => toggleOwned(openCard.id, finish, setId)}
  onClose={() => setOpenCardId(null)}
/>
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run verify`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/web/sets/CardSheet.tsx src/web/sets/CardSheet.test.tsx src/web/sets/CardSheet.module.css src/web/sets/WebSetCardsScreen.tsx
git commit -m "Price each printing in the card sheet, and total what is owned"
```

---

### Task 2: Render the shell at real phone dimensions

**Files:**

- Modify: `playwright.config.ts:22-26`
- Test: `e2e/phone-layout.spec.ts` (create)

**Interfaces:**

- Consumes: nothing from Task 1.
- Produces: a `phone` Playwright project at 390x844. Later tasks and future e2e specs can target it with `test.describe.configure` or by project name.

**Why:** `index.html` hardcoded `width=600, height=600` in the viewport meta for months, so every device reported a 600x600 layout viewport and a phone was indistinguishable from the glasses in both JS and CSS. That is fixed, but nothing has ever asserted the result at phone dimensions — the single Playwright project is still 600x600, the exact shape the bug faked.

- [ ] **Step 1: Add the phone project**

In `playwright.config.ts`, extend `projects`:

```ts
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 600, height: 600 } } },
    /**
     * A real phone shape. The glasses are small AND square; a phone is small and
     * tall, and layoutMode branches on exactly that difference — so this project
     * is the only one that exercises the web shell's own code path.
     */
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
```

- [ ] **Step 2: Write the failing test**

Create `e2e/phone-layout.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

/**
 * These assertions are about layout physics, not appearance: nothing may
 * overflow horizontally, and every control a finger is meant to hit must be
 * large enough to hit. Both were tuned against a 600x600 square and have never
 * been checked at 390x844.
 */

test.describe("web shell at phone size", () => {
  test.skip(({ browserName }, testInfo) => testInfo.project.name !== "phone", "phone project only");

  test("the set grid does not scroll sideways", async ({ page }) => {
    await page.goto("/?ui=web#/sets");
    await page
      .getByRole("button", { name: /Pitch Black/ })
      .first()
      .click();
    await expect(page.getByRole("list")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("every filter chip is a 44px touch target", async ({ page }) => {
    await page.goto("/?ui=web#/sets");
    await page
      .getByRole("button", { name: /Pitch Black/ })
      .first()
      .click();

    const chips = page.getByRole("group", { name: "Filter by rarity" }).getByRole("button");
    const count = await chips.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const box = await chips.nth(i).boundingBox();
      expect(box, `chip ${i} has no box`).not.toBeNull();
      expect(box!.height, `chip ${i} height`).toBeGreaterThanOrEqual(44);
    }
  });

  test("the card sheet fits on screen and its printing rows are tappable", async ({ page }) => {
    await page.goto("/?ui=web#/sets");
    await page
      .getByRole("button", { name: /Pitch Black/ })
      .first()
      .click();
    await page
      .getByRole("button", { name: /printings owned/ })
      .first()
      .click();

    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();

    const box = await sheet.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.height).toBeLessThanOrEqual(viewport.height);

    const rows = sheet.getByRole("button", { pressed: false });
    const rowCount = await rows.count();
    for (let i = 0; i < rowCount; i++) {
      const rowBox = await rows.nth(i).boundingBox();
      if (!rowBox) continue;
      expect(rowBox.height, `printing row ${i} height`).toBeGreaterThanOrEqual(44);
    }
  });
});
```

The route and set name must match what the mock provider serves. Read `src/integrations/pokemon/MockPokemonProvider.ts` and `src/app/screenUrl.ts` first and adjust the `goto` path and the set name to whatever the mocks actually contain — do not guess.

- [ ] **Step 3: Run the test and record what fails**

Run: `npx playwright test e2e/phone-layout.spec.ts --project=phone`
Expected: some assertions FAIL. This is the point of the task — the layout has never been checked at this size. Record which ones in the commit message.

- [ ] **Step 4: Fix only what the assertions caught**

Work in `src/web/sets/WebSetCardsScreen.module.css` and `src/web/sets/CardSheet.module.css`. The likely faults, each with its fix:

- **Chips shorter than 44px** — the glasses list needs compact rows, the phone does not. Add `min-height: 44px` to `.chip` and let the grid gap do the spacing.
- **Grid overflowing** — a fixed tile width that assumed 600px. Use `grid-template-columns: repeat(auto-fill, minmax(96px, 1fr))` so tiles reflow instead of overrunning.
- **Sheet taller than the viewport** — the printing list has no bound. Add `max-height: 80vh` and `overflow-y: auto` to `.sheet`, keeping `.close` outside the scrolling region so Done is always reachable.

Change only what an assertion actually failed on. A fix with no failing assertion behind it is a guess.

- [ ] **Step 5: Re-run until green**

Run: `npx playwright test e2e/phone-layout.spec.ts --project=phone`
Expected: PASS.

- [ ] **Step 6: Verify the glasses did not regress**

The two shells share CSS files, so a phone fix can move the 600x600 layout.

Run: `npx playwright test --project=chromium`
Expected: PASS, unchanged.

- [ ] **Step 7: Commit**

```bash
git add playwright.config.ts e2e/phone-layout.spec.ts src/web/sets/*.module.css
git commit -m "Test the web shell at phone size, and fix what that exposed

<list the assertions that failed before the fix>."
```

---

### Task 3: Sort a set by value on the phone

**Files:**

- Modify: `src/web/sets/WebSetCardsScreen.tsx:30-58,66-88`
- Test: `src/web/sets/WebSetCardsScreen.test.tsx`

**Interfaces:**

- Consumes: `SetView.headlinePriceFor` from the Shared Interface Contract.
- Produces: no new exports.

**Why:** sets render in collector-number order because that is binder order and it is right for working through a set. But "what is the expensive thing I am missing" is a different question, and on a phone — with a scrollbar and no focus ring — it is cheap to answer. The glasses deliberately do not get this: `byCollectorNumber` is muscle memory there, and value ordering reshuffles as prices load.

- [ ] **Step 1: Write the failing test**

Add to `src/web/sets/WebSetCardsScreen.test.tsx`:

```tsx
it("orders by value when asked, and returns to binder order", async () => {
  renderScreen({
    cards: [
      { id: "me5-001", name: "Cheap Card", collectorNumber: "001", marketPrice: 1 },
      { id: "me5-002", name: "Dear Card", collectorNumber: "002", marketPrice: 50 },
    ],
    printings: { "001": [{ type: "normal", price: 1 }], "002": [{ type: "normal", price: 50 }] },
  });

  const binderOrder = await screen.findAllByRole("button", { name: /printings owned/ });
  expect(binderOrder[0]).toHaveAccessibleName(/Cheap Card/);

  await userEvent.click(screen.getByRole("button", { name: "By value" }));

  const valueOrder = await screen.findAllByRole("button", { name: /printings owned/ });
  expect(valueOrder[0]).toHaveAccessibleName(/Dear Card/);

  await userEvent.click(screen.getByRole("button", { name: "By value" }));

  const restored = await screen.findAllByRole("button", { name: /printings owned/ });
  expect(restored[0]).toHaveAccessibleName(/Cheap Card/);
});
```

Reuse the file's existing render helper rather than adding another.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/web/sets/WebSetCardsScreen.test.tsx`
Expected: FAIL — no "By value" control exists.

- [ ] **Step 3: Implement**

Add the state beside `missingOnly`:

```tsx
/** Binder order is the default; value order answers a different question. */
const [byValue, setByValue] = useState(false);
```

Replace the `cards` memo:

```tsx
const cards = useMemo(() => {
  const visible = missingOnly ? view.cards.filter((c) => !isComplete(c)) : view.cards;
  if (!byValue) return visible;
  // Copy before sorting: view.cards is memoised upstream and sorting in place
  // would mutate the cached binder order everything else reads.
  return [...visible].sort((a, b) => (view.headlinePriceFor(b) ?? 0) - (view.headlinePriceFor(a) ?? 0));
}, [view, missingOnly, isComplete, byValue]);
```

Add the control next to the missing-only chip:

```tsx
<button
  type="button"
  className={`${styles.chip} ${byValue ? styles.chipOn : ""}`}
  aria-pressed={byValue}
  onClick={() => setByValue((on) => !on)}
>
  By value
</button>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run verify`
Expected: PASS.

- [ ] **Step 5: Confirm the touch target still holds**

Run: `npx playwright test e2e/phone-layout.spec.ts --project=phone`
Expected: PASS — the new chip is inside the filter row the chip assertion walks.

- [ ] **Step 6: Commit**

```bash
git add src/web/sets/WebSetCardsScreen.tsx src/web/sets/WebSetCardsScreen.test.tsx
git commit -m "Let the phone sort a set by value as well as by binder order"
```

---

## Out of scope, deliberately

- **The home screen.** The resume row, live counts and progress bars landed today (`2c9f417`, `7c2fe78`) and `homeLayout.test.ts` pins the glasses-vs-web rule. Nothing to do.
- **The grid, the bottom sheet and the missing-only filter.** All shipped today (`23ecb36`).
- **Proxying card images through the server.** Rejected with reasons in `docs/handoff.md`: residential upload is slower than the CDN, a set is 10-25MB of thumbnails, and an outage would blank every image.
- **Anything touching the glasses shell.** The two shells share screens and data but not interaction; changing `SetCardsScreen` from this plan would undo that separation.
- **Prices on grid tiles.** A price under 96px of art either truncates or shrinks the art. The sheet is where the number belongs; Task 3 gives the grid the ordering instead.

---

## Known open item, not scheduled here

`docs/performance-plan.md` **item 5** — every mark rewrites the whole collection — is called out in `docs/handoff.md` as the next thing likely to be _felt_ as the collection grows. It is a storage concern, not a UI one, so it is not in this plan; schedule it separately.
