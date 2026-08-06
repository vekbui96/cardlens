import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Scratch data root for the e2e server.
 *
 * Without it the server falls back to its production paths under D:/services,
 * which do not exist on a dev machine (a stream of ENOENT warnings) and DO
 * exist on the home server — where a test run would write into the real
 * collection. Everything here is disposable.
 */
const DATA = join(tmpdir(), "cardlens-e2e");
/** A token so the authenticated routes can actually be exercised, not just 401'd. */
const E2E_TOKEN = "e2e-token";

/**
 * Playwright drives the app the way the glasses do: arrow keys, Enter, Escape.
 * We start BOTH the API server (companion relay) and the Vite dev server, with mocks
 * enabled so tests are deterministic and never hit the live Pokémon API.
 */
const PORT = 5173;
const BASE_URL = `http://localhost:${PORT}`;

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
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 600, height: 600 } } },
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
      testMatch: /(phone-layout|web-header|owned-cards|set-switcher|scan|showcase|binders)\.spec\.ts/,
    },
    /**
     * A laptop. Same reason the phone project is scoped: every other spec
     * assumes the 600x600 glasses shell and would resolve to the web shell here
     * and fail.
     */
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testMatch: /(desktop-layout|web-header|owned-cards|set-switcher|scan|showcase)\.spec\.ts/,
    },
  ],
  webServer: [
    {
      command: "npm run server:start",
      port: 8787,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      env: {
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
      },
    },
  ],
});
