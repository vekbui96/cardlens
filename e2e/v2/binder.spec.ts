import { expect, test, type Locator, type Page } from "@playwright/test";
import { openV2, stabiliseForSnapshot } from "./pages/base.ts";

/**
 * The binder builder, from `docs/v2/specs/05-binder.md`.
 *
 * Runs at both project widths (390 and 1440). The things that are genuinely
 * about a browser doing layout live here — a pocket's WIDTH cannot be asserted
 * in jsdom, which lays nothing out — and the decisions live in the unit tests
 * beside the code.
 */

/** Open one of the fixture binders. `?seed=binders` builds all three. */
async function openBinder(page: Page, id: string) {
  return openV2(page, `/binder/${id}`, { seed: "binders" });
}

/** The rendered width of one pocket, by its address. */
async function pocketWidth(page: Page, address = "0:0"): Promise<number> {
  const box = await page.locator(`[data-pocket="${address}"]`).first().boundingBox();
  if (!box) throw new Error(`no pocket at ${address}`);
  return box.width;
}

test.describe("the binder opens", () => {
  test("as it falls open: a cover, page 1, and what is in it", async ({ page }) => {
    await openBinder(page, "fx-full");

    await expect(page.getByRole("heading", { name: "Jolteon", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Page 1" })).toBeVisible();
    // The cover is a real slot before page 1, and the fixture gives it a card.
    await expect(page.getByRole("button", { name: /^Cover, Jolteon/ })).toBeVisible();
  });

  test("says how many pockets are filled, and the cover is not one of them", async ({ page }) => {
    // 27 pockets over three pages, all full — plus a cover, which is part of
    // the binder and not part of the contents.
    await openBinder(page, "fx-full");
    await expect(page.getByText("27 of 27 pockets filled")).toBeVisible();
  });

  test("says which binder is missing rather than rendering an empty one", async ({ page }) => {
    await openV2(page, "/binder/no-such-binder", { seed: "binders" });
    await expect(page.getByRole("heading", { name: "Binder not found" })).toBeVisible();
  });

  test("keeps an unowned card in its pocket, shadowed and tagged", async ({ page }) => {
    // Planning around gaps is the point of laying a binder out. The fixture
    // owns the first five printings and not the rest.
    await openBinder(page, "fx-full");
    // Three pages, so pocket 6 exists three times. Any of them will do.
    await expect(page.getByRole("button", { name: /^Pocket 6, Jolteon, not owned/ }).first()).toBeVisible();
    await expect(page.getByText("Don’t own").first()).toBeVisible();
  });
});

test.describe("a pocket is a pocket", () => {
  test("is the same size in 9 and 12, and bigger in 4", async ({ page }) => {
    /*
     * The rule the whole layout exists for.
     *
     * 9 and 12 both sleeve ordinary 63x88mm cards, so a pocket is the same
     * size in either and the PAGE gets wider. 4-pocket exists for jumbo promos
     * and top-loaders, so its pockets are genuinely bigger — drawing a jumbo at
     * a standard card's size says the format is merely emptier, when what it
     * actually is, is larger.
     *
     * One binder, reformatted between measurements, so nothing but the format
     * differs: same window, same rail state, same page.
     */
    await openBinder(page, "fx-empty");
    const nine = await pocketWidth(page);

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "12-pocket" }).click();
    await expect(page.getByRole("button", { name: "Pocket 12, empty" })).toBeVisible();
    const twelve = await pocketWidth(page);

    await page.getByRole("button", { name: "4-pocket" }).click();
    await expect(page.getByRole("button", { name: "Pocket 5, empty" })).toHaveCount(0);
    const four = await pocketWidth(page);

    expect(Math.abs(nine - twelve)).toBeLessThanOrEqual(1);
    expect(four).toBeGreaterThanOrEqual(nine * 1.3);
  });

  test("a 12-pocket page is wider than a 9-pocket one, because the PAGE grows", async ({ page }) => {
    // The other half of the same rule. If the page were a fixed width divided
    // by the column count — which is what v1 did — this would be equal, and the
    // pockets above would not be.
    await openBinder(page, "fx-empty");
    // The pocket's `li`, then the `ul` that holds the whole grid of them.
    const grid = page.locator('[data-pocket="0:0"]').locator("..").locator("..");
    const nine = (await grid.boundingBox())!;

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "12-pocket" }).click();
    await expect(page.getByRole("button", { name: "Pocket 12, empty" })).toBeVisible();
    const twelve = (await grid.boundingBox())!;

    expect(twelve.width).toBeGreaterThan(nine.width);
  });
});

test.describe("pages are added and removed on purpose", () => {
  test("an added page survives a reload, because nothing trims trailing empties", async ({ page }) => {
    // The bug: a trim ran on every commit, so "Add page" grew the binder and
    // the same call dropped the new empty page again. The button did nothing at
    // all, in silence, for as long as binders existed.
    await openBinder(page, "fx-empty");
    await page.getByRole("button", { name: "Add page" }).click();
    await expect(page.getByRole("heading", { name: "Page 2" })).toBeVisible();

    // Reloaded WITHOUT the seed: re-seeding would rebuild the fixture binders
    // and this would be asserting that the fixture ran, not that the page kept.
    await page.goto("/?v=2#/binder/fx-empty");
    await expect(page.getByRole("heading", { name: "Page 2" })).toBeVisible();
  });

  test("removing is refused for the only page, and for one that holds cards", async ({ page }) => {
    // Removing a page that holds cards would destroy them with no undo.
    await openBinder(page, "fx-empty");
    await expect(page.getByRole("button", { name: "Remove page" })).toBeDisabled();

    await openBinder(page, "fx-full");
    await expect(page.getByRole("button", { name: "Remove page" })).toBeDisabled();
  });

  test("removing an empty last page puts the binder back", async ({ page }) => {
    await openBinder(page, "fx-empty");
    await page.getByRole("button", { name: "Add page" }).click();
    await expect(page.getByRole("button", { name: "Remove page" })).toBeEnabled();

    await page.getByRole("button", { name: "Remove page" }).click();
    await expect(page.getByRole("heading", { name: "Page 2" })).toHaveCount(0);
  });
});

test.describe("filling a pocket", () => {
  test("opens the picker on the pocket chosen, and names it", async ({ page }) => {
    await openBinder(page, "fx-empty");
    await page.getByRole("button", { name: "Pocket 3, empty" }).click();
    await expect(page.getByText("Filling pocket 3 on page 1.")).toBeVisible();
  });

  test("puts a card in it, and moves on to the next empty one", async ({ page }) => {
    // Filling a binder is a sequence. Leaving the selection put meant the next
    // card replaced the one just placed, and a binder that refuses to grow past
    // a single card reads exactly like a picker that will not add anything.
    await openBinder(page, "fx-empty");
    await page.getByRole("button", { name: "Pocket 1, empty" }).click();
    await firstPickerCard(page).click();

    await expect(page.getByRole("button", { name: /Pocket 1, empty/ })).toHaveCount(0);
    await expect(page.getByText("Filling pocket 2 on page 1.")).toBeVisible();
  });

  test("fills the cover without counting it as a pocket", async ({ page }) => {
    // A cover is part of the binder, not part of the contents — the same way
    // the clear sleeve on the front of a Vault X is.
    await openBinder(page, "fx-empty");
    await expect(page.getByText("0 of 9 pockets filled")).toBeVisible();

    await page.getByRole("button", { name: "Cover, empty" }).click();
    await expect(page.getByText("Filling the cover.")).toBeVisible();
    await firstPickerCard(page).click();

    await expect(page.getByRole("button", { name: "Cover, empty" })).toHaveCount(0);
    // Still zero. The cover is not one of the nine.
    await expect(page.getByText("0 of 9 pockets filled")).toBeVisible();
  });
});

/**
 * The first card the picker is offering, whichever set it opened on.
 *
 * Named by the pattern every picker tile ends with, so the test does not depend
 * on which set the mock catalog happens to sort first.
 */
function firstPickerCard(page: Page): Locator {
  return page.getByRole("button", { name: /, (owned|not owned)$/ }).first();
}

/**
 * Dragging, and the picker rail — both desktop.
 *
 * Drag is asserted on the DESKTOP project rather than the phone one because a
 * phone project is touch-emulated, and Chrome's emulation answers a mouse drag
 * by panning: it fires `pointercancel` on the first move and takes the pointer
 * away, so the gesture under test never happens. That is emulation, not the
 * app — a finger on real hardware presses, HOLDS, and then moves, and the hold
 * is what stops the browser claiming the gesture. See `useBinderDrag`, and the
 * unit tests that drive the touch path directly with fake timers.
 */
test.describe("dragging, on a desktop", () => {
  // Playwright requires an object-destructuring first argument here.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "v2-desktop", "desktop project only");
  });

  /** A press, a move past the drag threshold, and a release over the target. */
  async function dragTo(page: Page, from: Locator, to: Locator) {
    // Both ends measured only once nothing is going to scroll: a box is in
    // viewport coordinates, so measuring the second end after scrolling to it
    // leaves the first end's coordinates pointing at whatever moved into place.
    await to.scrollIntoViewIfNeeded();
    await from.scrollIntoViewIfNeeded();
    /*
     * Wait for the page to stop moving before measuring anything.
     *
     * Selecting a pocket scrolls it back into view with `behavior: "smooth"`,
     * and opens the picker rail — which re-lays the pages out. A box read while
     * either is still running points at wherever the pocket used to be, and the
     * drop lands two rows away. A fixed sleep is a guess; this waits for the
     * actual thing.
     */
    await page.waitForFunction(
      () => {
        const el = document.querySelector("[data-pocket]") as HTMLElement | null;
        if (!el) return false;
        const w = window as unknown as { __lastY?: number; __still?: number };
        const y = Math.round(el.getBoundingClientRect().top);
        w.__still = y === w.__lastY ? (w.__still ?? 0) + 1 : 0;
        w.__lastY = y;
        return (w.__still ?? 0) > 3;
      },
      undefined,
      { polling: 50, timeout: 5000 },
    );
    const a = (await from.boundingBox())!;
    const b = (await to.boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    // Two moves: the first crosses the threshold that turns a press into a
    // drag, the second is what the hit test actually reads.
    await page.mouse.move(a.x + a.width / 2 + 24, a.y + a.height / 2, { steps: 4 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();
  }

  /**
   * The sparse fixture with a second, DIFFERENT card put in beside the first.
   *
   * Two cards that can be told apart is the whole requirement: the fixture
   * names every card Jolteon, so a swap of two of them would be invisible.
   */
  async function twoCardsOnPageThree(page: Page) {
    await openBinder(page, "fx-sparse");
    await page.getByRole("button", { name: "Pocket 1, empty" }).nth(2).click();
    await firstPickerCard(page).click();
    await expect(page.locator('[data-pocket="2:0"]')).not.toHaveAttribute("aria-label", /empty/);
  }

  test("swaps two pockets rather than overwriting one", async ({ page }) => {
    // Overwriting would destroy a card with no undo. Two cards changing places
    // is what dragging one onto another physically means.
    await twoCardsOnPageThree(page);
    const one = page.locator('[data-pocket="2:0"]');
    const seven = page.locator('[data-pocket="2:6"]');
    const before = {
      one: await one.getAttribute("aria-label"),
      seven: await seven.getAttribute("aria-label"),
    };
    expect(before.one).not.toBe(before.seven);

    await dragTo(page, one, seven);

    await expect(one).toHaveAttribute("aria-label", (before.seven ?? "").replace("Pocket 7", "Pocket 1"));
    await expect(seven).toHaveAttribute("aria-label", (before.one ?? "").replace("Pocket 1", "Pocket 7"));
  });

  test("does not open the picker on a pocket a card was merely dropped into", async ({ page }) => {
    // The pointerup that ends a drag still fires the pocket's click. Left
    // alone, rearranging a page would open the picker once per card moved.
    await twoCardsOnPageThree(page);
    // Placing already advanced the selection to pocket 2 — filling is a
    // sequence, so the picker moved on by itself. Nothing to click.
    await expect(page.getByText("Filling pocket 2 on page 3.")).toBeVisible();

    await dragTo(page, page.locator('[data-pocket="2:0"]'), page.locator('[data-pocket="2:8"]'));

    await expect(page.locator('[data-pocket="2:8"]')).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByText("Filling pocket 2 on page 3.")).toBeVisible();
  });

  test("keeps the card when it is dropped back where it started", async ({ page }) => {
    // The commonest way a drag ends — a press that moved a few pixels, or a
    // change of mind. Without the guard the two writes cancel out to "put it
    // there, then clear where it came from" at the same address, and the card
    // is destroyed by being moved nowhere.
    await openBinder(page, "fx-sparse");
    const pocket = page.locator('[data-pocket="2:6"]');
    const before = await pocket.getAttribute("aria-label");

    await dragTo(page, pocket, pocket);

    await expect(pocket).toHaveAttribute("aria-label", before ?? "");
    await expect(page.getByText("1 of 36 pockets filled")).toBeVisible();
  });

  test("moves a card onto the cover, and the pocket count goes down", async ({ page }) => {
    // Filled on page 1 rather than page 3, so the card and the cover are on
    // screen at the same time: a drag is measured in viewport coordinates, and
    // scrolling to one end after reading the other is how a drop lands
    // somewhere nobody aimed.
    await openBinder(page, "fx-empty");
    await page.getByRole("button", { name: "Pocket 1, empty" }).click();
    await firstPickerCard(page).click();
    await expect(page.getByText("1 of 9 pockets filled")).toBeVisible();

    await dragTo(page, page.locator('[data-pocket="0:0"]'), page.locator('[data-pocket="cover"]'));

    await expect(page.getByRole("button", { name: "Cover, empty" })).toHaveCount(0);
    // A cover is not a pocket, so the card left the count when it left the page.
    await expect(page.getByText("0 of 9 pockets filled")).toBeVisible();
  });
});

test.describe("the picker rail, on a desktop", () => {
  // Playwright requires an object-destructuring first argument here.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "v2-desktop", "desktop project only");
  });

  test("is shut to begin with, and costs the spread nothing while it is", async ({ page }) => {
    /*
     * A 12-POCKET binder, deliberately: it is the widest spread and the one the
     * default protects. Two 12-pocket pages plus the gutter need 1108px, and
     * while a shut rail still held grid track the pages beside it lost 33px of
     * pocket — a 12-pocket page drew 92px pockets against a 9-pocket page's
     * 125px, which is exactly the inconsistency "a pocket is a pocket" exists
     * to remove. Even a 28px handle cost 3.5px.
     */
    await openBinder(page, "fx-sparse");
    const rail = page.getByRole("complementary", { name: "Cards" });
    await expect(rail).toBeHidden();
    const shut = await pocketWidth(page);

    await page.getByRole("button", { name: "Cards", exact: true }).click();
    await expect(rail).toBeVisible();
    const open = await pocketWidth(page);

    // Open, the rail takes its width from the spread — which is the proof that
    // shut it was taking none.
    expect(open).toBeLessThan(shut);

    await page.getByRole("button", { name: "Hide cards" }).click();
    await expect(rail).toBeHidden();
    expect(await pocketWidth(page)).toBeCloseTo(shut, 0);
  });

  test("opens by itself when a pocket is chosen, because that IS asking for cards", async ({ page }) => {
    await openBinder(page, "fx-empty");
    await expect(page.getByRole("complementary", { name: "Cards" })).toBeHidden();

    await page.getByRole("button", { name: "Pocket 1, empty" }).click();
    await expect(page.getByRole("complementary", { name: "Cards" })).toBeVisible();
  });
});

test.describe("the picker sheet, on a phone", () => {
  // Playwright requires an object-destructuring first argument here.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "v2-phone", "phone project only");
  });

  test("is absent until a pocket is chosen, and Escape puts it away", async ({ page }) => {
    // A phone has no room for a picker standing by, and the layout confirmed on
    // hardware is a sheet that appears with the selection.
    await openBinder(page, "fx-empty");
    await expect(page.getByRole("dialog", { name: "Cards" })).toHaveCount(0);

    await page.getByRole("button", { name: "Pocket 1, empty" }).click();
    await expect(page.getByRole("dialog", { name: "Cards" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Cards" })).toHaveCount(0);
  });

  test("stacks pages one at a time, rather than side by side", async ({ page }) => {
    await openBinder(page, "fx-full");
    const two = (await page.getByRole("heading", { name: "Page 2" }).boundingBox())!;
    const three = (await page.getByRole("heading", { name: "Page 3" }).boundingBox())!;
    // Below, not beside.
    expect(three.y).toBeGreaterThan(two.y);
  });
});

test.describe("binder @visual", () => {
  test("a full binder looks like itself", async ({ page }) => {
    await openBinder(page, "fx-full");
    await expect(page.getByRole("heading", { name: "Jolteon", level: 1 })).toBeVisible();
    await stabiliseForSnapshot(page);
    /*
     * The whole page, not `main`.
     *
     * The shell's header is `position: sticky`, and a locator screenshot of a
     * region taller than the viewport is scrolled and stitched — so the sticky
     * header paints over the top of `main` in the capture and hides the
     * binder's own title. Full page renders the header once, where it belongs.
     */
    await expect(page).toHaveScreenshot("binder.png", { fullPage: true });
  });
});
