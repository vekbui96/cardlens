import { test, expect } from "@playwright/test";

/** Matches the token the e2e API server is started with — see playwright.config.ts. */
const E2E_TOKEN = "e2e-token";

/**
 * The binder builder, on the shell that actually has it.
 *
 * Binders are web-only: laying one out is a drag of the eye across a page and a
 * tap into a pocket, which a four-gesture focus ring on a 600x600 additive
 * display cannot do. So this runs at phone size, where layoutMode resolves to
 * the web shell.
 *
 * Sync itself is not exercised here — e2e runs against mocks with no token, so
 * a sync run returns before it reaches the network. What IS worth asserting is
 * that the screen survived moving off its own useState and onto the shared
 * library state, and that the image control states its precondition instead of
 * failing silently when there is nowhere to store the bytes.
 */
test.describe("binders", () => {
  // Playwright requires an object-destructuring first argument here.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "phone project only");
  });

  test("creates a binder, opens it, and fills a pocket", async ({ page }) => {
    await page.goto("/?ui=web#/binders");

    await page.getByLabel("Binder name").fill("Master set");
    await page.getByRole("button", { name: "Create binder" }).click();

    // Creating navigates straight into the new binder.
    await expect(page.getByRole("button", { name: /Pocket 1, empty/ })).toBeVisible();

    await page.getByRole("button", { name: /Pocket 1, empty/ }).click();
    await expect(page.getByText(/Pocket 1 on page 1 selected/)).toBeVisible();

    // The screen opens on Pitch Black, which the mock fixtures do not carry —
    // see e2e/phone-layout.spec.ts. Pick a set that exists there.
    await page.getByLabel("Cards from").selectOption({ label: "Obsidian Flames" });

    // The picker lists one entry per printing; take whichever is first.
    const card = page.getByRole("button", { name: /, (owned|not owned)$/ }).first();
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.getByRole("button", { name: /Pocket 1, empty/ })).toHaveCount(0);
  });

  test("says why an image cannot be added when the device is not connected", async ({ page }) => {
    // A silent early return here would be the exact shape this codebase keeps
    // being bitten by: the button does nothing, and nothing says why.
    await page.goto("/?ui=web#/binders");
    await page.getByLabel("Binder name").fill("Photos");
    await page.getByRole("button", { name: "Create binder" }).click();
    await page.getByRole("button", { name: /Pocket 1, empty/ }).click();

    await page
      .getByLabel("Add image")
      .setInputFiles({ name: "divider.png", mimeType: "image/png", buffer: onePixelPng() });

    await expect(page.getByRole("alert")).toContainText("Connect this device to the server first");
  });

  test("uploads an image to the server and renders it from there", async ({ page }) => {
    // The one path nothing else covers: resize on the device, POST the data
    // URL, store the returned id, and resolve that id back to a URL at render
    // time. Every step is somewhere the picture could silently vanish.
    await page.addInitScript((token) => {
      window.localStorage.setItem(
        "cardlens:v1:sync-settings",
        JSON.stringify({ token, lastPushedAt: 0, lastPulledAt: 0, lastSyncAt: 0 }),
      );
    }, E2E_TOKEN);

    await page.goto("/?ui=web#/binders");
    await page.getByLabel("Binder name").fill("Photos");
    await page.getByRole("button", { name: "Create binder" }).click();
    await page.getByRole("button", { name: /Pocket 1, empty/ }).click();

    await page
      .getByLabel("Add image")
      .setInputFiles({ name: "divider.png", mimeType: "image/png", buffer: onePixelPng() });

    // The pocket takes the label from the filename, so this proves the slot was
    // placed rather than merely that some image element exists.
    const pocket = page.getByRole("button", { name: /Pocket 1, divider/ });
    await expect(pocket).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);

    const image = pocket.locator("img");
    await expect(image).toHaveAttribute("src", /\/binders\/images\/[\w-]+\.jpg$/);
    // Rendered, not just referenced: a 404 would still leave the src attribute
    // looking perfectly correct.
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  });

  test("adds a page, and the page is still there after a reload", async ({ page }) => {
    // This shipped broken: the screen added a page by placing a null slot on a
    // new index, and the same commit ran trimPages, which dropped it again. The
    // button did nothing and said nothing. Asserting through a RELOAD matters —
    // an in-memory page that never reached storage would pass without it.
    await page.goto("/?ui=web#/binders");
    await page.getByLabel("Binder name").fill("Big binder");
    await page.getByRole("button", { name: "Create binder" }).click();

    await expect(page.getByRole("region", { name: /^Page / })).toHaveCount(1);
    await page.getByRole("button", { name: "Add page" }).click();
    await expect(page.getByRole("region", { name: /^Page / })).toHaveCount(2);

    await page.reload();
    await expect(page.getByRole("region", { name: /^Page / })).toHaveCount(2);

    // And its inverse, which is what makes trimming the user's decision.
    await page.getByRole("button", { name: "Remove page" }).click();
    await expect(page.getByRole("region", { name: /^Page / })).toHaveCount(1);
    // Never the last one.
    await expect(page.getByRole("button", { name: "Remove page" })).toBeDisabled();
  });

  test("a deleted binder stays gone", async ({ page }) => {
    await page.goto("/?ui=web#/binders");
    await page.getByLabel("Binder name").fill("Doomed");
    await page.getByRole("button", { name: "Create binder" }).click();

    await page.goto("/?ui=web#/binders");
    await expect(page.getByText("Doomed")).toBeVisible();
    // Two presses, on two different buttons. The tombstone is written so the
    // deletion survives a sync, which is exactly why one press must not do it.
    await page.getByRole("button", { name: "Delete Doomed" }).click();
    await page.getByRole("button", { name: "Confirm delete Doomed" }).click();
    await expect(page.getByText("Doomed")).toHaveCount(0);

    // Through a reload, because the tombstone lives in storage and a merge on
    // read that got the rule backwards would bring it back here.
    await page.reload();
    await expect(page.getByText("Doomed")).toHaveCount(0);
  });
});

function onePixelPng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
}

test.describe("binder spreads on a phone", () => {
  // Playwright requires an object-destructuring first argument here.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "phone project only");
  });

  test("opens page 1 at full width once the spread stacks", async ({ page }) => {
    // `grid-column: 2` puts page 1 against the inside front cover on a wide
    // screen. It does NOT fall back when the spread collapses to one column —
    // it creates an implicit second track — so page 1 rendered at half width
    // against an empty left half, with pockets a third the size of every other
    // page's. Live for as long as spreads have existed; found by screenshotting.
    await page.goto("/?ui=web#/binders");
    await page.getByLabel("Binder name").fill("Phone spread");
    await page.getByRole("button", { name: "Create binder" }).click();

    const spread = page.locator("[data-cover]");
    await expect(spread).toBeVisible();
    const spreadBox = await spread.boundingBox();
    const pageBox = await page.getByLabel("Page 1").boundingBox();

    // The page fills its spread rather than sitting in half of it.
    expect(pageBox!.width).toBeGreaterThan(spreadBox!.width * 0.9);
  });
});

test.describe("4-pocket binders", () => {
  // Playwright requires an object-destructuring first argument here.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "phone project only");
  });

  test("offers the format and lays it out two by two", async ({ page }) => {
    await page.goto("/?ui=web#/binders");
    await page.getByLabel("Binder name").fill("Jumbos");
    await page.getByRole("button", { name: "4-pocket", exact: true }).click();
    await page.getByRole("button", { name: "Create binder" }).click();

    // Four pockets, not nine.
    await expect(page.getByRole("button", { name: /Pocket \d, empty/ })).toHaveCount(4);
    await expect(page.getByRole("button", { name: "Pocket 5, empty" })).toHaveCount(0);
  });

  test("never puts two 4-pocket pages side by side", async ({ page }) => {
    // Two 2-column pages abreast read as one 4-across grid, which is exactly a
    // 12-pocket page — the formats would be indistinguishable at a glance.
    await page.goto("/?ui=web#/binders");
    await page.getByLabel("Binder name").fill("Jumbos");
    await page.getByRole("button", { name: "4-pocket", exact: true }).click();
    await page.getByRole("button", { name: "Create binder" }).click();

    await page.getByRole("button", { name: "Add page" }).click();
    await page.getByRole("button", { name: "Add page" }).click();
    await expect(page.getByLabel(/^Page \d$/)).toHaveCount(3);

    // Every page is alone in its row: three pages, three distinct parents.
    const rows = await page.evaluate(
      () =>
        new Set([...document.querySelectorAll('[aria-label^="Page "]')].map((el) => el.parentElement)).size,
    );
    expect(rows).toBe(3);
    // And page 1 is not shoved into a right-hand column it has no facing page for.
    const row = page.locator("[data-solo]").first();
    const rowBox = await row.boundingBox();
    const pageBox = await page.getByLabel("Page 1").boundingBox();
    expect(pageBox!.width).toBeGreaterThan(rowBox!.width * 0.9);
  });
});

test.describe("binder value on the list", () => {
  // Playwright requires an object-destructuring first argument here.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "phone project only");
  });

  test("shows nothing until a binder asks to be priced", async ({ page }) => {
    // The list makes no pricing requests at all by default — one request per
    // set per binder is not a cost to pay for a screen you are passing through.
    await page.goto("/?ui=web#/binders");
    await page.getByLabel("Binder name").fill("Quiet");
    await page.getByRole("button", { name: "Create binder" }).click();
    // Back to the list by URL rather than by the header control: it also
    // proves the row is drawn from stored state, not from anything left in
    // memory by the screen that just wrote it.
    await page.goto("/?ui=web#/binders");

    await expect(page.getByText("Quiet")).toBeVisible();
    await expect(page.getByText("Pricing…")).toHaveCount(0);
  });

  test("carries the total back to the page before, once toggled on", async ({ page }) => {
    await page.goto("/?ui=web#/binders");
    await page.getByLabel("Binder name").fill("The good one");
    await page.getByRole("button", { name: "Create binder" }).click();

    // Put a real, priced card in it.
    await page.getByRole("button", { name: "Pocket 1, empty" }).click();
    await page.getByLabel("Cards from").selectOption({ label: "Obsidian Flames" });
    await page
      .getByRole("button", { name: /, (owned|not owned)$/ })
      .first()
      .click();

    // A binder setting, so it lives in the Settings panel rather than on the
    // toolbar — the toolbar is for what you press while laying pages out.
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Show value", exact: true }).click();
    await expect(page.getByRole("button", { name: "✓ Show value" })).toBeVisible();

    // Back to the list by URL rather than by the header control: it also
    // proves the row is drawn from stored state, not from anything left in
    // memory by the screen that just wrote it.
    await page.goto("/?ui=web#/binders");

    // A dollar figure on the row, and never $0.00 for a binder holding a card
    // the oracle can price.
    const row = page.locator("li", { hasText: "The good one" }).first();
    await expect(row.getByText(/^\$\d/)).toBeVisible({ timeout: 15000 });
    await expect(row.getByText("$0.00")).toHaveCount(0);
  });

  test("keeps the toggle after a reload, because it rides on the binder", async ({ page }) => {
    await page.goto("/?ui=web#/binders");
    await page.getByLabel("Binder name").fill("Sticky");
    await page.getByRole("button", { name: "Create binder" }).click();
    // A binder setting, so it lives in the Settings panel rather than on the
    // toolbar — the toolbar is for what you press while laying pages out.
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Show value", exact: true }).click();

    await page.reload();
    // Collapsed again after a reload, so the state reads from the tag beside
    // the Settings button rather than from the control itself.
    await expect(page.getByText("Priced in list")).toBeVisible();
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("button", { name: "✓ Show value" })).toBeVisible();
  });
});

/**
 * The cover, and dragging cards around.
 *
 * Both are gestures rather than state, so they are asserted here rather than in
 * jsdom: a drag is pointerdown, a move past a threshold, a hit test against
 * `elementFromPoint`, and a pointerup — and `elementFromPoint` is exactly the
 * part a jsdom test cannot answer, because nothing in jsdom has a layout.
 */
/**
 * The cover: a real slot before page 1, and not one of the pockets.
 *
 * Filled here by SELECTING it and picking a card, which is the gesture every
 * device has. Dragging onto it is covered below, on desktop.
 */
test.describe("the binder cover", () => {
  // Playwright requires an object-destructuring first argument here.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "phone project only");
  });

  test("holds a card without counting it as one of the pockets", async ({ page }) => {
    await page.goto("/?ui=web#/binders");
    await page.getByLabel("Binder name").fill("Covered");
    await page.getByRole("button", { name: "Create binder" }).click();

    await expect(page.getByRole("button", { name: "Cover, empty" })).toBeVisible();
    await expect(page.getByText("0/9")).toBeVisible();

    await page.getByRole("button", { name: "Cover, empty" }).click();
    await expect(page.getByText(/Cover selected/)).toBeVisible();

    await page.getByLabel("Cards from").selectOption({ label: "Obsidian Flames" });
    await page
      .getByRole("button", { name: /, (owned|not owned)$/ })
      .first()
      .click();

    // On the cover — and the pocket count has NOT moved, because a cover is not
    // one of the nine pockets being filled.
    await expect(page.getByRole("button", { name: "Cover, empty" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Cover, ./ })).toBeVisible();
    await expect(page.getByText("0/9")).toBeVisible();
    await expect(page.getByRole("button", { name: /Pocket 1, empty/ })).toBeVisible();
  });

  test("keeps its cover through a reload, because the cover rides on the binder", async ({ page }) => {
    // A new field on the binder has to be named in the sync whitelist AND
    // survive storage. This is the half storage can answer.
    await page.goto("/?ui=web#/binders");
    await page.getByLabel("Binder name").fill("Covered");
    await page.getByRole("button", { name: "Create binder" }).click();
    await page.getByRole("button", { name: "Cover, empty" }).click();
    await page.getByLabel("Cards from").selectOption({ label: "Obsidian Flames" });
    await page
      .getByRole("button", { name: /, (owned|not owned)$/ })
      .first()
      .click();
    const label = await page.getByRole("button", { name: /^Cover, ./ }).getAttribute("aria-label");

    await page.reload();
    await expect(page.getByRole("button", { name: /^Cover, ./ })).toHaveAttribute("aria-label", label ?? "");
  });

  test("stacks above page 1 when the spread has collapsed to one column", async ({ page }) => {
    await page.goto("/?ui=web#/binders");
    await page.getByLabel("Binder name").fill("Narrow");
    await page.getByRole("button", { name: "Create binder" }).click();

    const cover = (await page.getByRole("button", { name: "Cover, empty" }).boundingBox())!;
    const page1 = (await page.getByRole("region", { name: "Page 1" }).boundingBox())!;
    // Above, not beside: there is no second column to be beside.
    expect(cover.y).toBeLessThan(page1.y);
  });
});

/**
 * Dragging, and the picker rail — both desktop.
 *
 * Drag is asserted on the DESKTOP project rather than the phone one because a
 * phone project is touch-emulated, and Chrome's emulation answers a mouse drag
 * by panning: it fires `pointercancel` on the first move and takes the pointer
 * away, so the gesture under test never happens. That is emulation, not the
 * app — a finger on real hardware presses, HOLDS, and then moves, and the hold
 * is what keeps the browser from claiming the gesture (see useBinderDrag, and
 * the unit tests that drive the touch path directly with fake timers).
 */
test.describe("dragging cards around the binder", () => {
  // Playwright requires an object-destructuring first argument here.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop project only");
  });

  /** A binder with its first two pockets filled from the mock catalog. */
  async function binderWithTwoCards(page: import("@playwright/test").Page) {
    await page.goto("/?ui=web#/binders");
    await page.getByLabel("Binder name").fill("Arrange me");
    await page.getByRole("button", { name: "Create binder" }).click();

    await page.getByRole("button", { name: /Pocket 1, empty/ }).click();
    await page.getByLabel("Cards from").selectOption({ label: "Obsidian Flames" });
    const cards = page.getByRole("button", { name: /, (owned|not owned)$/ });
    // Placing advances the selection to the next empty pocket, so two clicks
    // fill pockets 1 and 2 without touching the page in between.
    await cards.nth(0).click();
    await expect(page.getByRole("button", { name: /Pocket 1, empty/ })).toHaveCount(0);
    await cards.nth(1).click();
    await expect(page.getByRole("button", { name: /Pocket 2, empty/ })).toHaveCount(0);
  }

  /** A press, a move past the drag threshold, and a release over the target. */
  async function dragTo(
    page: import("@playwright/test").Page,
    from: import("@playwright/test").Locator,
    to: import("@playwright/test").Locator,
  ) {
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

  test("swaps two pockets rather than overwriting one", async ({ page }) => {
    // Overwriting would destroy a card with no undo. Two cards changing places
    // is what dragging one onto another physically means.
    await binderWithTwoCards(page);
    const one = await page.getByRole("button", { name: /^Pocket 1, / }).getAttribute("aria-label");
    const two = await page.getByRole("button", { name: /^Pocket 2, / }).getAttribute("aria-label");
    expect(one).not.toBe(two);

    await dragTo(
      page,
      page.getByRole("button", { name: /^Pocket 1, / }),
      page.getByRole("button", { name: /^Pocket 2, / }),
    );

    // Both cards still in the binder, in each other's pockets.
    await expect(page.getByRole("button", { name: /^Pocket 1, / })).toHaveAttribute(
      "aria-label",
      (two ?? "").replace("Pocket 2", "Pocket 1"),
    );
    await expect(page.getByRole("button", { name: /^Pocket 2, / })).toHaveAttribute(
      "aria-label",
      (one ?? "").replace("Pocket 1", "Pocket 2"),
    );
  });

  test("moves a card onto the cover, and the pocket count goes down", async ({ page }) => {
    await binderWithTwoCards(page);
    await expect(page.getByText("2/9")).toBeVisible();

    await dragTo(
      page,
      page.getByRole("button", { name: /^Pocket 1, / }),
      page.getByRole("button", { name: "Cover, empty" }),
    );

    await expect(page.getByRole("button", { name: "Cover, empty" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Pocket 1, empty/ })).toBeVisible();
    // A cover is not a pocket, so the card left the count when it left the page.
    await expect(page.getByText("1/9")).toBeVisible();
  });

  test("does not open the picker on a pocket a card was merely dropped into", async ({ page }) => {
    // The pointerup that ends a drag still fires the pocket's click. Left
    // alone, rearranging a page would open the picker once per card moved.
    await binderWithTwoCards(page);
    // Filling pocket 2 already advanced the selection to pocket 3 — placing is
    // a sequence, so the picker moves on by itself. Nothing to click.
    await expect(page.getByText(/Pocket 3 on page 1 selected/)).toBeVisible();

    await dragTo(
      page,
      page.getByRole("button", { name: /^Pocket 1, / }),
      page.getByRole("button", { name: /Pocket 5, empty/ }),
    );

    // Still pocket 3 — the drop moved a card, it did not choose a pocket.
    await expect(page.getByText(/Pocket 5 on page 1 selected/)).toHaveCount(0);
    await expect(page.getByText(/Pocket 3 on page 1 selected/)).toBeVisible();
  });
});

test.describe("the picker on a desktop", () => {
  // Playwright requires an object-destructuring first argument here.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop project only");
  });

  test("is a rail that opens on demand and gives the width back when shut", async ({ page }) => {
    // Shut to begin with, because open it costs 340px and a 12-pocket spread
    // needs 1108px to keep its pockets card-sized. The binder keeps the room
    // until cards are actually asked for.
    //
    // A 12-POCKET binder, deliberately: it is the widest spread and the one the
    // default protects. A 9-pocket spread has slack at this window size and
    // would not shrink when the rail opens, so it could not tell the two states
    // apart.
    await page.goto("/?ui=web#/binders");
    await page.getByLabel("Binder name").fill("Wide");
    await page.getByRole("button", { name: "12-pocket", exact: true }).click();
    await page.getByRole("button", { name: "Create binder" }).click();

    await expect(page.getByRole("complementary", { name: "Cards" })).toBeVisible();
    await expect(page.getByLabel("Search every set")).toBeHidden();

    const pages = page.getByRole("region", { name: "Page 1" });
    const withoutRail = (await pages.boundingBox())!;

    await page.getByRole("button", { name: /Cards/ }).click();
    await expect(page.getByLabel("Search every set")).toBeVisible();

    // Opening takes the width from the binder, which is the whole trade.
    const withRail = (await pages.boundingBox())!;
    expect(withRail.width).toBeLessThan(withoutRail.width);

    await page.getByRole("button", { name: /Hide cards/ }).click();
    await expect(page.getByLabel("Search every set")).toBeHidden();
    expect((await pages.boundingBox())!.width).toBeCloseTo(withoutRail.width, 0);
  });

  test("comes out by itself when a pocket is chosen, because that is asking for cards", async ({ page }) => {
    await page.goto("/?ui=web#/binders");
    await page.getByLabel("Binder name").fill("Wide");
    await page.getByRole("button", { name: "Create binder" }).click();
    await expect(page.getByLabel("Search every set")).toBeHidden();

    await page.getByRole("button", { name: /Pocket 1, empty/ }).click();
    await expect(page.getByLabel("Search every set")).toBeVisible();
  });

  test("opens the binder against its cover, not above it", async ({ page }) => {
    // Page 1 sits in the right-hand column because that is where a binder falls
    // open. With both in one column the grid stacks them into two rows and the
    // binder appears to open downwards.
    await page.goto("/?ui=web#/binders");
    await page.getByLabel("Binder name").fill("Facing");
    await page.getByRole("button", { name: "Create binder" }).click();

    const cover = (await page.getByRole("button", { name: "Cover, empty" }).boundingBox())!;
    const page1 = (await page.getByRole("region", { name: "Page 1" }).boundingBox())!;
    expect(cover.x).toBeLessThan(page1.x);
    // Facing, so they overlap vertically rather than sitting one above the other.
    expect(cover.y).toBeLessThan(page1.y + page1.height);
    expect(page1.y).toBeLessThan(cover.y + cover.height);
  });
});
