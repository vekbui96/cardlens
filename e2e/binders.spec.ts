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
    await page.getByRole("button", { name: "Delete" }).click();
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
