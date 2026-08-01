import { defineConfig, devices } from "@playwright/test";

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
    { name: "phone", use: { ...devices["Pixel 7"] }, testMatch: /phone-layout\.spec\.ts/ },
  ],
  webServer: [
    {
      command: "npm run server:start",
      port: 8787,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
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
