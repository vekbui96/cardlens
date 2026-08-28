import { test, expect, type Page } from "@playwright/test";
import { openFromHome, select, swipeDown } from "./helpers.ts";

/**
 * Triple-pinch to mark every printing of a card at once.
 *
 * Confirmed working on the real glasses, and until now covered by nothing. It
 * earns an e2e rather than a component test because the burst deliberately
 * lives on the SCREEN, keyed on the focused card — the input adapter cannot see
 * what is focused, so a version that lived there had to reset on every other
 * event and any stray signal from the neural band killed the gesture silently.
 * That arrangement only exists once focus is real.
 *
 * Rows are read back out of localStorage rather than off the screen, because
 * this is a test about what gets WRITTEN. The collection is an OR-Set, so "not
 * owned" has two very different spellings: a tombstone, which converges, and a
 * missing row, which is indistinguishable from "never seen" and comes back on
 * the next sync from a stale device. Only the store can tell those apart.
 */

interface StoredRow {
  cardId: string;
  finish: string;
  at: number;
  deletedAt?: number;
}

const rows = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("cardlens:v1:collection") ?? "[]") as StoredRow[]);

const live = (all: StoredRow[]) => all.filter((r) => r.deletedAt === undefined);

/**
 * Into the first set with collect mode on and the first card focused.
 *
 * The collect toggle is a `switch`, not an `option` — MenuRow only works inside
 * a FocusList, so standalone controls are ToggleRow. It is row 0 and focused on
 * arrival; the finish picker is row 1, so cards start at row 2.
 */
async function openSetCollecting(page: Page): Promise<void> {
  await page.goto("/?ui=glasses");
  await expect(page.getByRole("heading", { name: "CardLens" })).toBeVisible();

  // "Browse by set", not "Sets": the Collection row's subtitle is "Track your
  // sets", so the shorter label matches two rows.
  await openFromHome(page, "Browse by set");
  await expect(page.getByRole("heading", { name: "Sets" })).toBeVisible();

  await swipeDown(page);
  await select(page);

  const collect = page.getByRole("switch");
  await expect(collect).toBeVisible();
  await select(page);
  // Switching on relabels it to name the printing a pinch would mark.
  await expect(collect).toContainText(/Marking:/);

  await swipeDown(page); // finish picker
  await swipeDown(page); // first card
  await expect(page.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
}

/**
 * Count writes to the collection key.
 *
 * Without this the suite cannot see the difference this gesture's fix made:
 * marking four printings one at a time and marking them in one batch produce
 * byte-identical rows, which is exactly why the slow version survived unnoticed
 * for so long. The number of writes is the only observable difference, and at
 * the 20,000-row cap each one is a full read-merge-prune-serialise pass — 13ms
 * measured, so four of them is 52ms on the gesture that exists to be fast.
 */
async function countCollectionWrites(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const real = Storage.prototype.setItem;
    (window as unknown as { __writes: number }).__writes = 0;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.endsWith(":collection")) (window as unknown as { __writes: number }).__writes += 1;
      return real.call(this, key, value);
    };
  });
}

const writes = (page: Page) => page.evaluate(() => (window as unknown as { __writes: number }).__writes);

/** Three pinches inside the 1200ms burst window. */
async function triplePinch(page: Page): Promise<void> {
  await select(page);
  await select(page);
  await select(page);
}

/**
 * This block races a real 1200ms window, so it is retried locally too.
 *
 * The gesture is three pinches inside the burst window the product actually
 * enforces (CLAUDE.md: 500ms felt broken on a neural band, 1200ms works). Each
 * `press()` is a CDP round-trip, and locally Playwright runs many workers —
 * under that contention three round-trips can outlast 1200ms, the burst reads
 * as three ordinary marks, and the test fails having exercised the product
 * correctly. Measured: 4/4 pass at `--workers=1`, roughly 3-in-5 with the
 * default worker count.
 *
 * CI already had cover (`workers: 1`, `retries: 2`); this gives the same
 * locally rather than leaving a test that cries wolf on every full run.
 *
 * **Do not "fix" this by dispatching synthetic KeyboardEvents in the page.**
 * They never reach the input adapter, so the test passes without exercising
 * anything — tried, and reverted.
 */
test.describe.configure({ retries: 2 });

test.describe("triple-pinch bulk mark", () => {
  // Playwright requires an object-destructuring first argument here.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "the glasses shell drives this gesture");
  });

  test("fills every printing of the card in one write", async ({ page }) => {
    await countCollectionWrites(page);
    await openSetCollecting(page);
    const before = await writes(page);
    await triplePinch(page);

    await expect.poll(async () => live(await rows(page)).length).toBeGreaterThan(1);

    const filled = live(await rows(page));
    // Every printing belongs to the one focused card — a burst must never
    // spill onto its neighbours.
    expect(new Set(filled.map((r) => r.cardId)).size).toBe(1);
    // One batched write, so every row lands on the same timestamp.
    expect(new Set(filled.map((r) => r.at)).size).toBe(1);

    // The assertion that actually discriminates. Two ordinary marks precede the
    // bulk one -- the first two pinches of the burst -- so the bulk action
    // itself is whatever is left, and it must be exactly one.
    expect((await writes(page)) - before).toBe(3);
  });

  test("clears a complete card with tombstones, keeping each row's original mark time", async ({ page }) => {
    await openSetCollecting(page);
    await triplePinch(page);
    await expect.poll(async () => live(await rows(page)).length).toBeGreaterThan(1);
    const filled = live(await rows(page));

    await triplePinch(page);
    await expect.poll(async () => live(await rows(page)).length).toBe(0);

    const cleared = await rows(page);
    // Nothing dropped: same rows, now tombstoned.
    expect(cleared.length).toBe(filled.length);
    expect(cleared.every((r) => typeof r.deletedAt === "number")).toBe(true);
    expect(new Set(cleared.map((r) => r.deletedAt)).size).toBe(1);

    // The tombstone is built from the row that existed, not synthesised. A
    // fresh one would carry a new `at`, which is what the merge resolves ties
    // against — so a stale device could win and resurrect the card.
    const reverse = cleared.find((r) => r.finish === "reverse");
    const filledReverse = filled.find((r) => r.finish === "reverse");
    expect(reverse?.at).toBe(filledReverse?.at);
  });
});
