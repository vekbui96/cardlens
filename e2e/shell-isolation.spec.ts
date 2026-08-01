import { test, expect } from "@playwright/test";

/**
 * The web theme must not reach the glasses.
 *
 * styles/web-theme.css restyles the app for a phone: softer surfaces, a smaller
 * type scale, shadows, hover states. Every one of those is actively wrong on the
 * Meta display, which is ADDITIVE — black is transparent there, so an "elevated
 * dark surface" glows as a grey rectangle in the wearer's vision, and 15px body
 * text is unreadable at glance distance.
 *
 * Isolation is by cascade, not by discipline: the overrides are scoped to
 * [data-shell="web"], and the other two shells carry a different value. This
 * spec is what stops that seam being quietly broken by a future selector that
 * forgets the scope.
 *
 * Runs in the default chromium project (600x600) and drives the shells with
 * ?ui= overrides rather than viewport size, so it tests the theme boundary
 * rather than layoutMode's detection, which app/layoutMode.test.ts already
 * covers.
 */

/** Computed styles of the shell root and of body text inside it. */
async function shellStyles(page: import("@playwright/test").Page, ui: string) {
  await page.goto(`/?ui=${ui}`);
  const root = page.locator("[data-shell]");
  await expect(root).toBeVisible();
  return root.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      shell: el.getAttribute("data-shell"),
      background: s.backgroundColor,
      fontSize: s.fontSize,
      // Read the token directly: the most direct evidence of which layer won.
      bgToken: s.getPropertyValue("--cl-bg").trim(),
      bodyToken: s.getPropertyValue("--cl-fs-body").trim(),
      accentToken: s.getPropertyValue("--cl-accent").trim(),
    };
  });
}

test.describe("web theme isolation", () => {
  test("the glasses shell keeps pure black and the glance-distance type scale", async ({ page }) => {
    const glasses = await shellStyles(page, "glasses");

    expect(glasses.shell).toBe("glasses");
    // Pure black is not a style choice on this display, it is transparency.
    expect(glasses.bgToken).toBe("#000000");
    expect(glasses.background).toBe("rgb(0, 0, 0)");
    expect(glasses.bodyToken).toBe("22px");
  });

  test("the preview shell mimics the glasses, not the web theme", async ({ page }) => {
    // Preview exists to show what the device looks like. If it picked up the web
    // theme it would stop being a preview of anything.
    const preview = await shellStyles(page, "preview");

    expect(preview.shell).toBe("preview");
    expect(preview.bgToken).toBe("#000000");
    expect(preview.bodyToken).toBe("22px");
  });

  test("the web shell gets its own palette and type scale", async ({ page }) => {
    const web = await shellStyles(page, "web");

    expect(web.shell).toBe("web");
    expect(web.bgToken).not.toBe("#000000");
    expect(web.bodyToken).not.toBe("22px");
    // Elevation needs somewhere to sit, so the background must not be pure black.
    expect(web.background).not.toBe("rgb(0, 0, 0)");
  });

  test("the two shells disagree on every themed token", async ({ page }) => {
    const glasses = await shellStyles(page, "glasses");
    const web = await shellStyles(page, "web");

    expect(web.bgToken).not.toBe(glasses.bgToken);
    expect(web.bodyToken).not.toBe(glasses.bodyToken);
    expect(web.accentToken).not.toBe(glasses.accentToken);
  });

  test("no web-only token leaks into the glasses shell", async ({ page }) => {
    await page.goto("/?ui=glasses");
    const leaked = await page.locator("[data-shell]").evaluate((el) => {
      const s = getComputedStyle(el);
      // Declared only in web-theme.css. Any value here means the scope broke.
      return ["--cl-shadow-lg", "--cl-border", "--cl-transition", "--cl-radius-sm"].filter(
        (t) => s.getPropertyValue(t).trim() !== "",
      );
    });

    expect(leaked, `web-only tokens visible on the glasses: ${leaked.join(", ")}`).toEqual([]);
  });
});
