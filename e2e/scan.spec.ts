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

    await expect(page.getByRole("button", { name: /review 1/i })).toBeVisible();
    expect(external, `scan made external requests: ${external.join(", ")}`).toHaveLength(0);
  });

  test("does not resize the preview when a card is captured", async ({ page }) => {
    // The first version put results in the same column as the preview, so the
    // stage shrank on the first capture and the guide moved under the card the
    // user was still holding.
    await page.goto("/?ui=web#/scan");
    await page.getByRole("button", { name: "Start camera" }).click();
    const capture = page.getByTestId("capture");
    await expect(capture).toBeEnabled({ timeout: 15000 });

    const stage = page.locator("video");
    const before = await stage.boundingBox();
    await capture.click();
    await capture.click();
    await expect(page.getByRole("button", { name: /review 2/i })).toBeVisible();
    const after = await stage.boundingBox();

    expect(after!.height, "preview shrank after capturing").toBeCloseTo(before!.height, 0);
    expect(after!.y, "preview moved after capturing").toBeCloseTo(before!.y, 0);
  });

  test("keeps scanning without asking, then reviews the batch", async ({ page }) => {
    await page.goto("/?ui=web#/scan");
    await page.getByRole("button", { name: "Start camera" }).click();
    const capture = page.getByTestId("capture");
    await expect(capture).toBeEnabled({ timeout: 15000 });

    // Three cards in a row with no interruption — that is the whole point.
    await capture.click();
    await capture.click();
    await capture.click();
    await expect(page.getByRole("group", { name: "Scan result" })).toHaveCount(0);

    await page.getByRole("button", { name: /review 3/i }).click();
    await expect(page.getByTestId("review-row")).toHaveCount(3);
  });

  test("will not add a card it could not identify on its own", async ({ page }) => {
    // The fake device shows a rolling pattern, not a card, so every capture
    // lands unsure. Those must not be silently filed.
    await page.goto("/?ui=web#/scan");
    await page.getByRole("button", { name: "Start camera" }).click();
    await page.getByTestId("capture").click();
    await page.getByRole("button", { name: /review 1/i }).click();

    await expect(page.getByRole("button", { name: "Nothing to add" })).toBeDisabled();
    await expect(page.getByText(/still needs? a choice/)).toBeVisible();
  });

  test("adds the batch once the unsure ones are answered", async ({ page }) => {
    await page.goto("/?ui=web#/scan");
    await page.getByRole("button", { name: "Start camera" }).click();
    await page.getByTestId("capture").click();
    await page.getByTestId("capture").click();
    await page.getByRole("button", { name: /review 2/i }).click();

    // Answer the first, reject the second.
    const rows = page.getByTestId("review-row");
    await rows.first().getByRole("group", { name: "Pick the card" }).getByRole("button").first().click();
    await rows.nth(1).getByRole("button", { name: "Reject" }).click();

    await page.getByRole("button", { name: "Add 1 card" }).click();

    // Back to scanning with an empty queue, and the header counts the session.
    await expect(page.getByTestId("capture")).toBeVisible();
    await expect(page.getByText("1 added")).toBeVisible();
    await expect(page.getByRole("button", { name: "Done" })).toBeDisabled();
  });

  test("does not un-mark a card that is already owned", async ({ page }) => {
    // A pile being digitised overlaps what is already held. The first version
    // committed with toggleOwned, so scanning an owned card REMOVED it — worst
    // on the most complete sets, and silent.
    await page.addInitScript(() => {
      localStorage.setItem(
        "cardlens:v1:collection",
        JSON.stringify([{ cardId: "me5-1", setId: "me5", finish: "normal", at: 1_700_000_000_000 }]),
      );
    });
    await page.goto("/?ui=web#/scan");
    await page.getByRole("button", { name: "Start camera" }).click();
    await page.getByTestId("capture").click();
    await page.getByRole("button", { name: /review 1/i }).click();

    // Pick whichever card the fake pattern matched, then commit it twice over
    // by adding, going back, and adding the same choice again.
    const rows = page.getByTestId("review-row");
    await rows.first().getByRole("group", { name: "Pick the card" }).getByRole("button").first().click();
    const chosen = await rows
      .first()
      .getByRole("group", { name: "Pick the card" })
      .getByRole("button")
      .first()
      .innerText();
    await page.getByRole("button", { name: "Add 1 card" }).click();

    await page.getByTestId("capture").click();
    await page.getByRole("button", { name: /review 1/i }).click();
    await rows.first().getByRole("group", { name: "Pick the card" }).getByRole("button").first().click();
    await page.getByRole("button", { name: "Add 1 card" }).click();

    // Marked twice, still owned once — not removed by the second pass.
    const held = await page.evaluate(() => {
      const raw = localStorage.getItem("cardlens:v1:collection") ?? "[]";
      return (JSON.parse(raw) as { deletedAt?: number }[]).filter((r) => !r.deletedAt).length;
    });
    expect(held, `a re-scanned card was removed instead of kept (${chosen})`).toBeGreaterThanOrEqual(2);
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
