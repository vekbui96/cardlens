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
