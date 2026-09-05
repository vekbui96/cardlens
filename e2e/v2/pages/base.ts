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
  /**
   * Let card art and set logos actually be fetched. Off by default — see
   * `stubImages`. Only turn it on to test image loading itself.
   */
  realImages?: boolean;
}

/** A 1x1 transparent PNG. Smallest thing that is still a valid image. */
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Answer every image request locally, instantly.
 *
 * Card art comes from images.pokemontcg.io through the wsrv.nl resizing proxy —
 * two third parties, on the open internet, in the middle of a test. That is the
 * real source of the visual flake: `stabiliseForSnapshot` waits for
 * `networkidle`, and networkidle waits for them. It is not the pixels (the art
 * is hidden before any screenshot) — it is the wait, which is why the failure
 * looked like a timeout rather than a diff.
 *
 * Fulfilling here rather than aborting keeps the request observable, so a spec
 * can still COUNT image requests — which the binder shelf does, to prove it
 * fetches nothing beyond the visible tiles.
 */
async function stubImages(page: Page): Promise<void> {
  await page.route(
    (url) => /^https?:/.test(url.protocol) && !url.hostname.includes("localhost"),
    async (route) => {
      // `fallback`, NOT `continue`. Playwright checks handlers in reverse
      // registration order, and this one is installed inside `openV2` — after
      // anything a spec set up beforehand. `continue()` would send the request
      // straight to the network and skip those handlers entirely, so a spec
      // that aborts api.tcgdex.net to force a failure would instead succeed
      // against the live internet and quietly test nothing.
      if (route.request().resourceType() !== "image") return route.fallback();
      await route.fulfill({ status: 200, contentType: "image/png", body: PIXEL });
    },
  );
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
  if (options.realImages !== true) await stubImages(page);
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
