import { expect, test } from "@playwright/test";
import { openV2, stabiliseForSnapshot } from "./pages/base.ts";

/**
 * Visual regression for v2.
 *
 * Nine screens, built in parallel, sharing one set of primitives — the failure
 * mode is not that someone's screen breaks, it is that someone widens a Panel's
 * padding to suit their layout and silently changes the other eight. A
 * unit test cannot see that. This can.
 *
 * Snapshots run at both project widths (390 and 1440, see playwright.config).
 * Each stream adds ONE `toHaveScreenshot` per screen to its own spec file under
 * `e2e/v2/`; this file owns the primitives themselves.
 *
 * ## Updating a baseline on purpose
 *
 * Playwright names a snapshot after the platform that took it, because a
 * screenshot from Windows and one from Linux genuinely differ — font
 * rasterisation and scrollbar width. Both sets are committed, and **both have
 * to be regenerated together**, or CI fails on Linux for a change that looked
 * fine on Windows:
 *
 *   npm run snapshots         # this platform (needs nothing)
 *   npm run snapshots:linux   # what CI actually gates (needs Docker)
 *
 * Read the diff before committing either. A baseline updated without looking is
 * a regression test that has been switched off.
 */

test.describe("primitives", () => {
  test("the workshop looks like itself", async ({ page }) => {
    await openV2(page, "/dev/workshop", { seed: "binders" });
    await expect(page.getByRole("heading", { name: "Workshop", level: 1 })).toBeVisible();
    await stabiliseForSnapshot(page);
    await expect(page).toHaveScreenshot("workshop.png", { fullPage: true });
  });
});

test.describe("shell", () => {
  test("header and navigation", async ({ page }) => {
    await openV2(page, "/", { seed: "collection" });
    await stabiliseForSnapshot(page);
    // The header alone, so an unrelated change inside a screen does not have to
    // re-baseline the chrome that every screen shares.
    await expect(page.getByRole("banner")).toHaveScreenshot("header.png");
  });

  test("an unbuilt screen states which spec owns it", async ({ page }) => {
    await openV2(page, "/binders");
    await stabiliseForSnapshot(page);
    await expect(page.getByRole("main")).toHaveScreenshot("not-built.png");
  });
});
