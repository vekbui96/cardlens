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
 * ## These run in a pinned container, and only there
 *
 * A screenshot is only reproducible in the environment that took it. Not just
 * the OS — the installed FONTS. Baselines generated in the official Playwright
 * image differ from ones taken on a bare `ubuntu-latest` runner by about 20px
 * of page height, because the two have different font packages and text wraps
 * differently. Both are "Linux"; neither matches the other.
 *
 * So these tests are tagged `@visual`, excluded from the ordinary e2e run, and
 * executed by a CI job whose `container:` is the exact image
 * `scripts/snapshots-linux.sh` uses. One environment, one set of baselines.
 *
 *   npm run snapshots:linux   # regenerate, in that same image (needs Docker)
 *
 * `npm run snapshots` regenerates for your own machine instead, which is useful
 * while iterating but is NOT what CI compares against — those files exist only
 * so the suite is runnable locally.
 *
 * Read the diff before committing a new baseline. One updated without looking
 * is a regression test that has been switched off.
 */

test.describe("primitives @visual", () => {
  test("the workshop looks like itself", async ({ page }) => {
    await openV2(page, "/dev/workshop", { seed: "binders" });
    await expect(page.getByRole("heading", { name: "Workshop", level: 1 })).toBeVisible();
    await stabiliseForSnapshot(page);
    await expect(page).toHaveScreenshot("workshop.png", { fullPage: true });
  });
});

test.describe("shell @visual", () => {
  test("header and navigation", async ({ page }) => {
    await openV2(page, "/", { seed: "collection" });
    await stabiliseForSnapshot(page);
    // The header alone, so an unrelated change inside a screen does not have to
    // re-baseline the chrome that every screen shares.
    await expect(page.getByRole("banner")).toHaveScreenshot("header.png");
  });

  /**
   * Must point at a route no stream has landed yet, or it stops testing the
   * placeholder and starts testing whatever screen moved in. It was `/binders`
   * until that stream landed and this failed with an 11k-pixel diff — which is
   * the test doing its job, but for the wrong reason.
   *
   * `/live/:id` belongs to spec 07, the last stream and the only one with a
   * dependency, so it is the safest bet. When 07 lands, move this to whatever
   * is still outstanding — or, if nothing is, delete it along with `NotBuilt`.
   */
  test("an unbuilt screen states which spec owns it", async ({ page }) => {
    await openV2(page, "/live/not-a-real-share");
    await expect(page.getByText(/Not built yet/)).toBeVisible();
    await stabiliseForSnapshot(page);
    await expect(page.getByRole("main")).toHaveScreenshot("not-built.png");
  });
});
