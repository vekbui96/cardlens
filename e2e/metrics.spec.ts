import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const E2E_TOKEN = "e2e-token";
const API_PORT = Number(process.env.CL_E2E_API_PORT ?? 8787);
/** Must match `DATA` in playwright.config.ts: metrics land beside the scratch collection. */
const DATA = join(tmpdir(), `cardlens-e2e-${API_PORT}`);

interface Summary {
  totals: Record<string, number>;
}

/**
 * Usage metrics, end to end: the app counts a screen view, flushes on page
 * hide with the device's token, the e2e API server stores it in its SCRATCH
 * data dir, and the public summary — read with no token, as the innovation
 * loop reads it — reports it.
 */
test.describe("usage metrics", () => {
  test("a screen view reaches the public summary", async ({ page }) => {
    const read = async (): Promise<Summary> => {
      const res = await page.request.get("/api/metrics/summary?days=1");
      expect(res.status()).toBe(200);
      return (await res.json()) as Summary;
    };
    // The e2e server outlives a run locally, so compare against what is there.
    const before = (await read()).totals["screen.sets"] ?? 0;

    await page.addInitScript((token) => {
      window.localStorage.setItem(
        "cardlens:v1:sync-settings",
        JSON.stringify({ token, lastPushedAt: 0, lastPulledAt: 0, lastSyncAt: 0 }),
      );
    }, E2E_TOKEN);
    await page.goto("/?ui=web#/sets");
    await expect(page.locator("body")).not.toBeEmpty();

    // Page hide is the flush that matters most on a phone; trigger it directly
    // rather than waiting out the debounce.
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));

    await expect.poll(async () => (await read()).totals["screen.sets"] ?? 0).toBeGreaterThan(before);
    // And it went to the scratch dir, never to D:/services/data.
    expect(existsSync(join(DATA, "metrics.json"))).toBe(true);
  });

  test("the summary answers a tokenless GET; the write refuses one", async ({ page }) => {
    const summary = await page.request.get("/api/metrics/summary");
    expect(summary.status()).toBe(200);
    const write = await page.request.post("/api/metrics", { data: { days: {} } });
    expect(write.status()).toBe(401);
  });
});
