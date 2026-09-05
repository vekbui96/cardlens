import { expect, test, type Page } from "@playwright/test";
import { openV2, stabiliseForSnapshot } from "./pages/base.ts";

/**
 * Set cards — `docs/v2/specs/03-set-cards.md`.
 *
 * The set is installed from a fixture rather than from the mock catalog, for
 * two reasons. The acceptance criterion is about a set of **120** cards and the
 * in-memory mock fixtures hold a handful; and the request budget only means
 * something if the printings response is the one piece of real network the
 * screen has, which it is — `useSetInformation` switches itself off under mocks,
 * so `/api/printings/:setId` is the single call the whole screen makes.
 *
 * The cards go in through the same `setCardsCache` entry the app writes itself
 * (`cache:set-cards:v3`), so this is the app's own cached-first path rather
 * than a back door: nothing here reaches past a public seam.
 */

const SET_ID = "pbl";
const SET_NAME = "Pitch Black";
const ROUTE = `/set/${SET_ID}/${encodeURIComponent(SET_NAME)}`;

/** The rarity the IR chip filters to. Five cards carry it. */
const IR = "Illustration Rare";

interface Installed {
  /** Every request the page made to our own server, in order. */
  api: string[];
  printings: string[];
}

/**
 * Put a set of `count` cards, and its printings, in front of the screen.
 *
 * Card 1 has three printings, card 2 carries a foil nobody has taught the app
 * about, and every second card is unpriced — the three states the spec calls
 * out, in one set.
 */
async function installSet(page: Page, count = 120): Promise<Installed> {
  const numbers = Array.from({ length: count }, (_, i) => String(i + 1));

  const card = (n: string, i: number) => ({
    id: `${SET_ID}-${n}`,
    name: `Card ${n}`,
    setName: SET_NAME,
    setCode: SET_ID,
    collectorNumber: n,
    ...(i < 5 ? { rarity: IR } : {}),
  });

  const cards = numbers.map(card);
  const irCards = cards.filter((c) => c.rarity === IR);

  const byNumber: Record<string, Array<Record<string, unknown>>> = {};
  numbers.forEach((n, i) => {
    const list: Array<Record<string, unknown>> = [
      // Half the set unpriced: absent is not zero, and the screen has to say so.
      { type: "normal", ...(i % 2 === 0 ? { price: Number(((i + 1) / 10).toFixed(2)) } : {}) },
    ];
    if (n === "1") list.push({ type: "reverse", price: 1.5 }, { type: "holo", price: 9.99 });
    // A foil invented after this code was written. It must read as words.
    if (n === "2") list.push({ type: "reverse", foil: "sparkle-crackle" });
    byNumber[n] = list;
  });

  // The two cache keys `useSetView` reads: unfiltered, and the rarity-filtered
  // list the IR chip asks for. Both are entries the app writes itself.
  await page.addInitScript(
    ([all, ir]) => {
      const now = Date.now();
      localStorage.setItem(
        "cardlens:v1:cache:set-cards:v3",
        JSON.stringify({
          [`${(all as { setCode: string }[])[0].setCode}|`]: { value: all, storedAt: now },
          [`${(all as { setCode: string }[])[0].setCode}|Illustration Rare`]: { value: ir, storedAt: now },
        }),
      );
    },
    [cards, irCards],
  );

  const api: string[] = [];
  const printings: string[] = [];
  page.on("request", (r) => {
    const url = r.url();
    if (!url.includes("/api/")) return;
    api.push(url);
    if (url.includes("/api/printings/")) printings.push(url);
  });

  // ONE response for the whole set — about 8KB in production, from the server's
  // disk cache. Fulfilled here so the count below cannot be a proxy's doing.
  await page.route("**/api/printings/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tcgdexSetId: SET_ID, byNumber }),
    }),
  );

  return { api, printings };
}

/** Every pocket is a marking target, and its name ends in its state. */
function pockets(page: Page) {
  return page.getByRole("button", { name: /, (owned|not owned|excluded)$/ });
}

test.describe("set cards", () => {
  test("a set of 120 cards issues ONE printings request, not 120", async ({ page }) => {
    // The budget this screen exists inside. Assembling a set's printings
    // upstream costs a request per card — 120 here, 295 for a big set — and the
    // server's cached aggregate is what makes it one. A regression would not
    // look like an error; it would look like the set screen getting slow.
    const seen = await installSet(page, 120);
    await openV2(page, ROUTE);

    await expect(page.getByRole("heading", { name: /Pitch Black/, level: 1 })).toBeVisible();
    // The set really is 120 cards: 120 normals, plus card 1's reverse and holo
    // and card 2's unknown foil.
    await expect(pockets(page)).toHaveCount(123);

    // ONE URL — one per SET, not one per card. Distinct rather than total,
    // because the dev server runs under `StrictMode`, whose simulated remount
    // aborts the first request and refetches it. That is a development-only
    // double-invoke of the SAME query, and it disappears in a production build;
    // a per-card regression would show up here as 120 DIFFERENT urls, which is
    // what this actually measures.
    expect([...new Set(seen.printings)]).toHaveLength(1);
    expect(seen.printings.length).toBeLessThanOrEqual(2);
    // And nothing else went to our server at all — no per-card fan-out hiding
    // behind a different path.
    expect([...new Set(seen.api)]).toEqual([...new Set(seen.printings)]);
  });

  test("a card with three printings offers three independent targets", async ({ page }) => {
    await installSet(page, 12);
    await openV2(page, ROUTE);

    for (const printing of ["Normal", "Reverse Holo", "Holofoil"]) {
      await expect(page.getByRole("button", { name: `Card 1, 1, ${printing}, not owned` })).toBeVisible();
    }

    // Marking one leaves its siblings alone. Marking a CARD when a collector
    // owns one of its three printings is the whole bug this screen avoids.
    await page.getByRole("button", { name: "Card 1, 1, Reverse Holo, not owned" }).click();
    await expect(page.getByRole("button", { name: "Card 1, 1, Reverse Holo, owned" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Card 1, 1, Normal, not owned" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Card 1, 1, Holofoil, not owned" })).toBeVisible();
  });

  test("marking a printing writes one row and survives a reload", async ({ page }) => {
    await installSet(page, 12);
    await openV2(page, ROUTE);

    await page.getByRole("button", { name: "Card 3, 3, Normal, not owned" }).click();
    await expect(page.getByRole("button", { name: "Card 3, 3, Normal, owned" })).toBeVisible();

    // One row, not one per printing offered and not one per render.
    const rows = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("cardlens:v1:collection") ?? "[]"),
    );
    expect(rows).toHaveLength(1);

    // Local-first: the mark is on the device before anything is sent anywhere.
    await page.reload();
    await expect(page.getByRole("button", { name: "Card 3, 3, Normal, owned" })).toBeVisible();
  });

  test("a filter switches to a flat grid, and clearing it restores the pages", async ({ page }) => {
    // A binder page drawn over a discontinuous run names something that does
    // not exist: its range lies and its count measures pockets that are not
    // next to each other in any binder.
    await installSet(page, 12);
    await openV2(page, ROUTE);

    await expect(page.getByTestId("binder-pages")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Page 1", level: 2 })).toBeVisible();
    await expect(page.getByTestId("filtered-count")).toBeHidden();

    await page.getByRole("button", { name: "Missing only" }).click();
    await expect(page.getByTestId("binder-pages")).toBeHidden();
    await expect(page.getByTestId("filtered-count")).toContainText("printings match these filters");

    await page.getByRole("button", { name: "Missing only" }).click();
    await expect(page.getByTestId("binder-pages")).toBeVisible();
    await expect(page.getByTestId("filtered-count")).toBeHidden();

    // The rarity bar does the same thing, from the other axis. The chips read
    // "IR" and "SIR" but are NAMED in full: two capital letters is not a label
    // anyone can act on without seeing the row they sit in.
    const rarities = page.getByRole("group", { name: "Filter by rarity" });
    await rarities.getByRole("button", { name: "Illustration Rare", exact: true }).click();
    await expect(page.getByTestId("binder-pages")).toBeHidden();
    await expect(page.getByTestId("filtered-count")).toBeVisible();

    await rarities.getByRole("button", { name: "All rarities" }).click();
    await expect(page.getByTestId("binder-pages")).toBeVisible();
  });

  test("an unrecognised foil renders as words, and stays unpriced", async ({ page }) => {
    // Sets keep inventing foils; anything hardcoded is wrong by the next
    // release. And an unknown pattern may NOT borrow its base type's price —
    // a confident wrong number is worse than a visible gap.
    await installSet(page, 12);
    await openV2(page, ROUTE);

    const pocket = page.getByRole("button", { name: /Card 2, 2, Sparkle crackle Reverse/ });
    await expect(pocket).toBeVisible();
    await expect(pocket).toContainText("Unavailable");
    await expect(pocket).not.toContainText("sparkle-crackle");
  });

  test("a set with no prices says so instead of showing a total built from nothing", async ({ page }) => {
    await installSet(page, 12);
    await openV2(page, ROUTE);
    // Half of this set is unpriced, which is the partial form, not a failure.
    await expect(page.getByText(/of \d+ printings priced/)).toBeVisible();
  });

  test("every marking target clears 44px", async ({ page }) => {
    // The reason is a thumb, so it does not shrink on a wide window either.
    await installSet(page, 12);
    await openV2(page, ROUTE);

    const boxes = await pockets(page).evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height };
      }),
    );
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) {
      expect(box.w).toBeGreaterThanOrEqual(44);
      expect(box.h).toBeGreaterThanOrEqual(44);
    }
  });

  test("the switcher moves between sets without going back", async ({ page }) => {
    await installSet(page, 12);
    await openV2(page, ROUTE);

    await page.getByRole("button", { name: `${SET_NAME}. Switch set` }).click();
    const sheet = page.getByRole("dialog", { name: "Switch set" });
    await expect(sheet).toBeVisible();
    // The set being viewed is always in its own switcher, even at zero owned.
    await expect(sheet.getByRole("button", { name: new RegExp(SET_NAME) })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "All sets" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });
});

test.describe("set cards @visual", () => {
  test("a set looks like a binder", async ({ page }) => {
    // A short set on purpose: the snapshot has to show the whole screen —
    // title, progress, the honest price line, the rarity bar and two full
    // pages — and a 120-card set would be 15,000px of the same nine pockets.
    await installSet(page, 12);
    await openV2(page, ROUTE);
    await expect(page.getByRole("heading", { name: "Page 2", level: 2 })).toBeVisible();
    await stabiliseForSnapshot(page);
    await expect(page.getByRole("main")).toHaveScreenshot("set-cards.png");
  });
});
