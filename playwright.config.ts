import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Ports, overridable per checkout.
 *
 * `reuseExistingServer` treats a busy port as "already running, reuse it". That
 * is right for a single developer re-running the suite, and catastrophic for
 * two checkouts at once — parallel worktrees, or two agents building different
 * screens — because the second one runs its whole suite against the FIRST
 * one's code and reports a pass. Give each checkout its own pair:
 *
 *   CL_E2E_PORT=5273 CL_E2E_API_PORT=8887 npm run e2e
 */
const WEB_PORT = Number(process.env.CL_E2E_PORT ?? 5173);
const API_PORT = Number(process.env.CL_E2E_API_PORT ?? 8787);

/**
 * Scratch data root for the e2e server, keyed by API port for the same reason.
 * Two servers sharing one collection.json is two suites writing over each
 * other's rows.
 *
 * Without it the server falls back to its production paths under D:/services,
 * which do not exist on a dev machine (a stream of ENOENT warnings) and DO
 * exist on the home server — where a test run would write into the real
 * collection. Everything here is disposable.
 */
const DATA = join(tmpdir(), `cardlens-e2e-${API_PORT}`);
/** A token so the authenticated routes can actually be exercised, not just 401'd. */
const E2E_TOKEN = "e2e-token";

/**
 * Playwright drives the app the way the glasses do: arrow keys, Enter, Escape.
 * We start BOTH the API server (companion relay) and the Vite dev server, with mocks
 * enabled so tests are deterministic and never hit the live Pokémon API.
 */
const BASE_URL = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    // Emulate the glasses display so layout assertions match the real target.
    viewport: { width: 600, height: 600 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 600, height: 600 } },
      /**
       * The v2 specs are excluded here, not merely included elsewhere.
       *
       * This project has no `testMatch`, so it runs everything — and at
       * 600x600 `resolveLayoutMode` returns `glasses`, where `activeUiVersion`
       * refuses to serve v2 at all. Every v2 spec would resolve to the v1
       * glasses shell and fail for a reason that has nothing to do with what it
       * was testing.
       */
      testIgnore: /[\\/]v2[\\/]/,
    },
    /**
     * A real phone shape. The glasses are small AND square; a phone is small and
     * tall, and layoutMode branches on exactly that difference — so this project
     * is the only one that exercises the web shell's own code path.
     *
     * Scoped to phone-layout.spec.ts only: every other e2e spec assumes the
     * glasses shell (600x600, focus ring, ScreenRouter's glasses screens). Left
     * unscoped, this project would also run those specs at the Pixel 7 viewport,
     * where they resolve to the web shell instead and fail.
     */
    {
      name: "phone",
      use: { ...devices["Pixel 7"] },
      testMatch: /(phone-layout|web-header|owned-cards|set-switcher|scan|showcase|binders|trade)\.spec\.ts/,
      /*
       * These names match on BASENAME, so `e2e/v2/binders.spec.ts` matched the
       * `binders` alternative and the v2 shelf quietly ran here as well as in
       * its own two projects — four viewports instead of two, at a size no v2
       * spec is written against. `scan`, `showcase` and `trade` are v2 spec
       * names too, so the next three streams would each have hit it. Excluded
       * for the same reason `chromium` excludes them, one line up.
       */
      testIgnore: /[\\/]v2[\\/]/,
    },
    /**
     * A laptop. Same reason the phone project is scoped: every other spec
     * assumes the 600x600 glasses shell and would resolve to the web shell here
     * and fail.
     */
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testMatch: /(desktop-layout|web-header|owned-cards|set-switcher|scan|showcase|binders)\.spec\.ts/,
      /* Same basename collision as `phone` above. */
      testIgnore: /[\\/]v2[\\/]/,
    },
    /**
     * v2, at the two widths its specs are written against.
     *
     * These exist so that no screen stream ever has to edit this file: a spec
     * dropped anywhere under `e2e/v2/` runs at both widths automatically, and
     * nine streams adding themselves to a shared regex — in parallel, in
     * separate worktrees — would conflict on every single merge.
     *
     * The widths are exact rather than a device preset because the visual
     * snapshots are keyed to them. 390 is an iPhone's CSS width, the narrowest
     * thing that matters; 1440 is a laptop.
     */
    {
      name: "v2-phone",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: false },
      testMatch: /[\\/]v2[\\/].*\.spec\.ts/,
    },
    {
      name: "v2-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testMatch: /[\\/]v2[\\/].*\.spec\.ts/,
    },
  ],
  webServer: [
    {
      command: "npm run server:start",
      port: API_PORT,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      env: {
        PORT: String(API_PORT),
        COLLECTION_TOKEN: E2E_TOKEN,
        COLLECTION_FILE: join(DATA, "collection.json"),
        BINDERS_FILE: join(DATA, "binders.json"),
        BINDER_IMAGES_DIR: join(DATA, "binder-images"),
        PRINTINGS_DIR: join(DATA, "printings"),
        SEALED_DIR: join(DATA, "sealed"),
        SHARES_FILE: join(DATA, "shares.json"),
      },
    },
    {
      command: "npm run dev",
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      env: {
        VITE_USE_MOCKS: "true",
        VITE_DEV_PORT: String(WEB_PORT),
        // Point this checkout's dev server at this checkout's API server, or a
        // second checkout's browser proxies /api to the first one's data.
        VITE_SERVER_TARGET: `http://localhost:${API_PORT}`,
      },
    },
  ],
});
