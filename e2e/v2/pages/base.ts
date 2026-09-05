import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Page objects for v2, expressed as intent.
 *
 * A spec here says `await shell.goTo("Binders")`, not
 * `page.locator(".nav a:nth-child(5)")`. Nine screens are being built at once
 * by people who will each rename a class at some point, and a suite written
 * against class names would break nine times for reasons that are not bugs.
 *
 * Everything below selects by ROLE and accessible name. That has a second
 * effect worth having on purpose: a control the tests can find is a control a
 * screen reader can find, so an inaccessible screen fails the suite rather than
 * quietly shipping.
 */

/** Fixtures, matching `src/dev/fixtures.ts`. */
export type Fixture = "empty" | "collection" | "binders" | "trade" | "scan";

export interface OpenOptions {
  /** Named starting state. Applied before React mounts. */
  seed?: Fixture;
  /** Catalog simulation — see `initialSimulationFromUrl` in contexts.tsx. */
  sim?: "fail" | "empty" | "slow";
}

/**
 * Open a v2 screen by its hash route.
 *
 * `?v=2` pins the version rather than relying on stored state, so a spec cannot
 * be affected by whatever a previous spec left in localStorage — and so a
 * failing test's URL can be pasted straight into a browser and show the same
 * thing.
 */
export async function openV2(page: Page, route = "/", options: OpenOptions = {}): Promise<V2Shell> {
  await stubRemoteImages(page);
  const params = new URLSearchParams({ v: "2" });
  if (options.seed) params.set("seed", options.seed);
  if (options.sim) params.set("sim", options.sim);
  await page.goto(`/?${params.toString()}#${route}`);
  const shell = new V2Shell(page);
  await shell.ready();
  return shell;
}

export class V2Shell {
  constructor(readonly page: Page) {}

  /** The shell is up when its navigation is. */
  async ready(): Promise<void> {
    await expect(this.nav).toBeVisible();
  }

  get nav(): Locator {
    return this.page.getByRole("navigation", { name: "Main" });
  }

  get main(): Locator {
    return this.page.getByRole("main");
  }

  navLink(label: string): Locator {
    return this.nav.getByRole("link", { name: label, exact: true });
  }

  async goTo(label: string): Promise<void> {
    await this.navLink(label).click();
  }

  /** The nav entry currently marked `aria-current="page"`. */
  get current(): Locator {
    return this.nav.locator('[aria-current="page"]');
  }

  get versionSwitch(): Locator {
    return this.page.getByRole("group", { name: "Interface version" });
  }

  async switchToV1(): Promise<void> {
    await this.versionSwitch.getByRole("button", { name: "Use interface V1" }).click();
  }

  /**
   * True when the v2 shell is the thing on screen. Used to assert the negative
   * — that `?v=1`, or a glasses-shaped viewport, does NOT get v2.
   */
  async isShowing(): Promise<boolean> {
    return (await this.page.locator('html[data-ui="v2"]').count()) > 0;
  }
}

/**
 * A 1x1 fully transparent PNG, inline so no test ever reads a file for it.
 *
 * Transparent and one pixel because nothing on screen is allowed to depend on
 * it: every image in v2 is sized by CSS — `CardArt` fills a container holding
 * `--v2-card-aspect`, a set logo is `5ch` by `2.4em` — so the intrinsic size of
 * what arrives never reaches layout, and `stabiliseForSnapshot` hides images
 * before any snapshot anyway.
 */
const BLANK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
  "base64",
);

/**
 * Answer every off-site IMAGE request locally, so no v2 spec touches the real
 * network.
 *
 * Card art goes to `images.pokemontcg.io` through the `wsrv.nl` resizing proxy
 * — two third parties, on the public internet, for nine to twenty-five requests
 * a page. `stabiliseForSnapshot` then waits for `networkidle`, which cannot
 * settle until the slowest of them does; under a loaded machine that is a test
 * failing for the weather. Fulfilling them here makes the wait a local one.
 *
 * Fulfilled rather than aborted on purpose: an aborted `<img>` fires `error`,
 * and a screen is entitled to draw something different when art fails to load.
 * A 1x1 transparent PNG loads successfully and draws nothing.
 *
 * Non-image off-site requests are left alone (`fallback`), so a spec that wants
 * to stub or observe one still can — and installing this twice is harmless.
 */
export async function stubRemoteImages(page: Page): Promise<void> {
  await page.route(
    (url) => url.hostname !== "localhost" && url.hostname !== "127.0.0.1",
    (route) => {
      if (route.request().resourceType() !== "image") return route.fallback();
      return route.fulfill({ status: 200, contentType: "image/png", body: BLANK_PNG });
    },
  );
}

/**
 * Hide everything that legitimately changes between runs, so a visual snapshot
 * fails only for a layout change.
 *
 * Card art is the big one: it comes from a third-party CDN over the network,
 * and a slow or missing image is a difference in pixels that says nothing about
 * the code. The sync line is the other — it counts minutes since a real clock.
 */
export async function stabiliseForSnapshot(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      img { visibility: hidden !important; }
      [data-snapshot="volatile"] { visibility: hidden !important; }
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
      }
    `,
  });
  await page.waitForLoadState("networkidle");
}
