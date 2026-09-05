import { expect, test } from "@playwright/test";
import { openV2, V2Shell } from "./pages/base.ts";

/**
 * The foundation's acceptance criteria, from `docs/v2/specs/00-foundation.md`.
 *
 * These are the guarantees every screen stream builds on top of, so they are
 * checked here once rather than assumed nine times.
 */

test.describe("version resolution", () => {
  test("?v=2 renders the v2 shell", async ({ page }) => {
    const shell = await openV2(page);
    expect(await shell.isShowing()).toBe(true);
    await expect(shell.nav).toBeVisible();
  });

  test("no flag renders v1", async ({ page }) => {
    await page.goto("/");
    const shell = new V2Shell(page);
    expect(await shell.isShowing()).toBe(false);
  });

  test("?v=1 renders v1 even after v2 was stored", async ({ page }) => {
    // Store v2 the way the switch does, then pin v1 in the URL. The URL wins.
    await openV2(page);
    await page.goto("/?v=1");
    const shell = new V2Shell(page);
    expect(await shell.isShowing()).toBe(false);
  });

  test("a 600x600 viewport renders v1 whatever ?v= says", async ({ page }) => {
    // The glasses. v2 is a web rebuild and must never mount on the device —
    // gated in `activeUiVersion`, not in the shell, so no v2 code can run there.
    await page.setViewportSize({ width: 600, height: 600 });
    await page.goto("/?v=2");
    const shell = new V2Shell(page);
    expect(await shell.isShowing()).toBe(false);
  });
});

test.describe("the switch", () => {
  test("is reachable from the v2 shell and returns to v1", async ({ page }) => {
    const shell = await openV2(page);
    await expect(shell.versionSwitch).toBeVisible();
    await shell.switchToV1();
    await expect(page.locator('html[data-ui="v2"]')).toHaveCount(0);
  });

  test("keeps the current route across the flip", async ({ page }) => {
    const shell = await openV2(page, "/binders");
    await shell.switchToV1();
    expect(page.url()).toContain("#/binders");
  });

  test("drops ?v= so storage is what decides afterwards", async ({ page }) => {
    const shell = await openV2(page);
    await shell.switchToV1();
    expect(page.url()).not.toContain("v=2");
  });

  test("v1 offers a way in", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitem", { name: /Try the new interface/ }).click();
    await expect(page.locator('html[data-ui="v2"]')).toHaveCount(1);
  });
});

test.describe("routing", () => {
  test("a route round-trips identically to v1", async ({ page }) => {
    const shell = await openV2(page, "/binders");
    // The hash is untouched by the version, so a link works in either.
    expect(page.url()).toContain("#/binders");
    await expect(shell.current).toHaveText("Binders");
  });

  test("navigation marks exactly one entry current", async ({ page }) => {
    const shell = await openV2(page);
    await shell.goTo("Binders");
    await expect(shell.current).toHaveCount(1);
    await expect(shell.current).toHaveText("Binders");
  });

  test("a #/sets link marks Collection, because they are one screen", async ({ page }) => {
    const shell = await openV2(page, "/sets");
    await expect(shell.current).toHaveText("Collection");
  });

  test("an unknown route falls back to home", async ({ page }) => {
    const shell = await openV2(page, "/nonsense");
    await expect(shell.current).toHaveText("Home");
  });

  test("back behaves as a stack", async ({ page }) => {
    // The browser's history IS the stack on web, which is what makes a phone's
    // back gesture pop a screen instead of leaving the app. v2 shares v1's
    // NavigationProvider, so this is really asserting it did not get bypassed.
    const shell = await openV2(page);
    await shell.goTo("Binders");
    await expect(shell.current).toHaveText("Binders");

    await shell.goTo("Scan");
    await expect(shell.current).toHaveText("Scan");

    await page.goBack();
    await expect(shell.current).toHaveText("Binders");
    await page.goBack();
    await expect(shell.current).toHaveText("Home");
  });
});

test.describe("fixtures", () => {
  test("?seed=binders puts a binder with cards into storage", async ({ page }) => {
    await openV2(page, "/", { seed: "binders" });
    const binders = await page.evaluate(() => {
      const raw = Object.keys(localStorage).find((k) => k.includes("binder"));
      return raw ? localStorage.getItem(raw) : null;
    });
    expect(binders).toContain("fx-full");
  });

  test("the same fixture works in v1, so both versions can be compared on it", async ({ page }) => {
    // The whole point of the toggle is answering "is the new one better" on the
    // same data. A fixture that only seeded one version could not do that.
    await page.goto("/?v=1&seed=binders#/binders");
    await expect(page.getByRole("heading", { name: /Binders/ })).toBeVisible();
    const stored = await page.evaluate(() => JSON.stringify(localStorage));
    expect(stored).toContain("fx-full");
  });
});

test.describe("the shell holds", () => {
  test("there is exactly one main landmark, and the skip link reaches it", async ({ page }) => {
    const shell = await openV2(page);
    await expect(shell.main).toHaveCount(1);
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toHaveAttribute("href", "#v2-main");
  });

  /**
   * The navigation must survive the LONGEST thing the header can say, at the
   * NARROWEST width. It did not: the brand and the header's right-hand side
   * were both `flex: none`, so the nav was the only child able to shrink and a
   * long sync label squeezed it to zero width. The element stayed in the DOM
   * and simply stopped being visible, which is why nothing caught it until an
   * unrelated spec happened to seed a sync token at 390px.
   */
  test("the navigation survives the longest sync message at 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const shell = await openV2(page);
    // "Sync: token rejected" is the longest of the six lines syncLine produces.
    await page.evaluate(() => {
      const el = document.querySelector('[data-snapshot="volatile"]');
      if (el) el.textContent = "Sync: token rejected";
    });
    await expect(shell.nav).toBeVisible();
    const width = await shell.nav.evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBeGreaterThan(0);
    // And every destination is still reachable by scrolling that strip.
    await expect(shell.navLink("Binders")).toHaveCount(1);
  });

  test("sync status is reachable from the shell", async ({ page }) => {
    const shell = await openV2(page);
    await expect(shell.page.locator('[data-snapshot="volatile"]')).toContainText("Sync:");
  });

  test("the workshop renders every primitive with no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));

    await openV2(page, "/dev/workshop");
    await expect(page.getByRole("heading", { name: "Workshop", level: 1 })).toBeVisible();
    // One heading per primitive group — if a group threw, its panel is missing.
    for (const group of [
      "Colour",
      "Type",
      "Stack · Row · Grid",
      "Panel · Card",
      "CardArt",
      "Meter · Chip · Money",
      "Rail · Sheet",
    ]) {
      await expect(page.getByRole("heading", { name: group })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
});

test.describe("v1 CSS does not leak into v2", () => {
  /**
   * The same guarantee `e2e/shell-isolation.spec.ts` makes for the glasses.
   * `web-theme.css` is scoped to `[data-shell="web"]`, which v2 never sets —
   * this asserts that rather than trusting it, because a single unscoped rule
   * added to that file would reach v2 silently and nobody would look there.
   */
  test("no element in v2 carries the v1 web shell attribute", async ({ page }) => {
    await openV2(page);
    await expect(page.locator('[data-shell="web"]')).toHaveCount(0);
  });

  test("body is not centred, as global.css would have it", async ({ page }) => {
    await openV2(page);
    // global.css sets `display:flex; align-items:center` on body for the
    // glasses. Inheriting it here centres the whole document vertically.
    const display = await page.evaluate(() => getComputedStyle(document.body).display);
    expect(display).toBe("block");
  });

  test("v2 defines its own viewport width, not the 600px glasses default", async ({ page }) => {
    await openV2(page);
    const viewport = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--v2-viewport").trim(),
    );
    expect(viewport).toBe("100%");
  });
});

test.describe("input", () => {
  /**
   * The review finding this exists for: `KeyboardBackedInputAdapter` attaches a
   * document-level keydown that `preventDefault()`s arrows, Enter and Escape.
   * Correct on the glasses, where those keys ARE the gestures. On the web it
   * takes arrow keys away from every field, select and scroll on the page.
   */
  test("arrow keys are not swallowed", async ({ page }) => {
    await openV2(page);
    const defaultPrevented = await page.evaluate(() => {
      const e = new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true, bubbles: true });
      document.body.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(defaultPrevented).toBe(false);
  });
});
