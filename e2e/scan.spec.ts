import { test, expect } from "@playwright/test";

/**
 * The scanner, driven against Chromium's fake camera.
 *
 * `--use-fake-device-for-media-stream` gives a synthetic video source and
 * `--use-fake-ui-for-media-stream` auto-grants permission, so the whole loop —
 * getUserMedia, preview, crop to the guide, hash, index lookup, render — runs
 * for real without a webcam or a human. Recognition ACCURACY is measured
 * separately against actual card art (scripts/validate-recognition.mjs); what
 * these check is that the plumbing holds together, which no amount of
 * hash-quality measurement would tell you.
 *
 * The fake device shows a rolling pattern, not a card, so a confident match is
 * neither expected nor asserted.
 */

test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--allow-file-access-from-files",
    ],
  },
});

test.describe("card scanner", () => {
  // Playwright requires an object-destructuring first argument here.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "phone" && testInfo.project.name !== "desktop", "web shells only");
  });

  test("loads the index that ships with the app", async ({ page }) => {
    await page.goto("/?ui=web#/scan");
    // The count proves the binary and its metadata were both fetched and agreed
    // on their length — a mismatch throws rather than silently misnaming cards.
    await expect(page.getByText(/cards indexed from your sets/)).toBeVisible();
  });

  test("opens the camera and captures without a round-trip", async ({ page }) => {
    const external: string[] = [];
    // Nothing may leave the device on the scan path. This is a privacy claim
    // the screen makes in words, so it gets an assertion.
    page.on("request", (r) => {
      const url = r.url();
      if (!url.startsWith("http://localhost") && !url.startsWith("data:")) external.push(url);
    });

    await page.goto("/?ui=web#/scan");
    await page.getByRole("button", { name: "Start camera" }).click();

    const capture = page.getByRole("button", { name: "Capture" });
    await expect(capture).toBeEnabled({ timeout: 15000 });
    await capture.click();

    await expect(page.getByRole("group", { name: "Scan result" })).toBeVisible();
    expect(external, `scan made external requests: ${external.join(", ")}`).toHaveLength(0);
  });

  test("offers a choice rather than guessing when it is not sure", async ({ page }) => {
    await page.goto("/?ui=web#/scan");
    await page.getByRole("button", { name: "Start camera" }).click();
    await page.getByRole("button", { name: "Capture" }).click();

    const result = page.getByRole("group", { name: "Scan result" });
    await expect(result).toBeVisible();
    // A rolling test pattern is not a card, so this must land in the unsure
    // branch and show alternatives instead of filing something wrong.
    await expect(result.getByText("Not sure — pick one")).toBeVisible();
    await expect(result.getByRole("button", { name: "Normal" })).toHaveCount(3);
  });

  test("marks a card owned and returns to scanning", async ({ page }) => {
    await page.goto("/?ui=web#/scan");
    await page.getByRole("button", { name: "Start camera" }).click();
    await page.getByRole("button", { name: "Capture" }).click();

    await page
      .getByRole("group", { name: "Scan result" })
      .getByRole("button", { name: "Normal" })
      .first()
      .click();

    // The result clears so the next card can go straight under the camera, and
    // the header counts what the session has added.
    await expect(page.getByRole("group", { name: "Scan result" })).toBeHidden();
    await expect(page.getByText("1 added")).toBeVisible();
  });

  test("is reachable from the menu", async ({ page }) => {
    await page.goto("/?ui=web#/sets");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menu", { name: "Go to" }).getByRole("menuitem", { name: /^Scan/ }).click();
    await expect(page).toHaveURL(/#\/scan$/);
  });
});

test.describe("the scanner on the glasses", () => {
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "glasses shell only");
  });

  test("is not rendered, and its chunk is never asked for", async ({ page }) => {
    const chunks: string[] = [];
    page.on("request", (r) => {
      if (/ScanScreen/.test(r.url())) chunks.push(r.url());
    });

    await page.goto("/#/scan");

    // A live preview on a 600x600 additive display would cost every row of the
    // list it replaced, and there is no pointer to aim with.
    await expect(page.getByRole("button", { name: "Start camera" })).toHaveCount(0);
    expect(chunks, "glasses downloaded the scanner chunk").toHaveLength(0);
  });
});
