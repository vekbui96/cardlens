import { test, expect, type Page } from "@playwright/test";

/** Matches the token the e2e API server is started with — see playwright.config.ts. */
const E2E_TOKEN = "e2e-token";

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

/**
 * Start the camera and wait until a capture can actually work.
 *
 * The button being enabled is not enough: the index can be loaded while the
 * video still has no dimensions, and a capture then reads a 0x0 frame and
 * silently queues nothing. Under parallel load that turned into a flake that
 * passed in isolation.
 */
async function startCamera(page: Page, { auto = false } = {}) {
  await page.getByRole("button", { name: "Start camera" }).click();
  // Auto is on by default. Tests that count captures must not race the
  // detection loop, so it is off unless a test is specifically about it.
  if (!auto) await page.getByRole("button", { name: "Auto on" }).click();
  await expect(page.getByTestId("capture")).toBeEnabled({ timeout: 20000 });
  await page.waitForFunction(
    () => {
      const v = document.querySelector("video");
      return Boolean(v && v.videoWidth > 0 && v.readyState >= 2);
    },
    { timeout: 20000 },
  );
}

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
    await expect(page.getByText(/[\d,]+ cards indexed/)).toBeVisible();
  });

  test("recognises on the device when this one is not connected", async ({ page }) => {
    // No token means no server, and the screen must not merely cope with that —
    // it must not reach the network at all. An unconnected device scanning in
    // aeroplane mode is the case the on-device index exists for.
    const requests: string[] = [];
    page.on("request", (r) => {
      const url = r.url();
      if (!url.startsWith("data:")) requests.push(url);
    });

    await page.goto("/?ui=web#/scan");
    await startCamera(page);
    await expect(page.getByTestId("engine")).toHaveText("On device");

    await page.getByTestId("capture").click();

    await expect(page.getByRole("button", { name: /review 1/i })).toBeVisible();
    const recognise = requests.filter((u) => u.includes("/api/recognize"));
    expect(recognise, `an unconnected device called the server: ${recognise.join(", ")}`).toHaveLength(0);
  });

  test("routes to the server when connected, and falls back when it cannot", async ({ page }) => {
    // The e2e API server runs with a real token but no recogniser behind it, so
    // /api/recognize answers 503. That is exactly the failover this asserts:
    // the capture is still identified, and the row says which one did it.
    await page.addInitScript((token) => {
      localStorage.setItem(
        "cardlens:v1:sync-settings",
        JSON.stringify({ token, lastPushedAt: 0, lastPulledAt: 0, lastSyncAt: 0 }),
      );
    }, E2E_TOKEN);

    const posted: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/api/recognize")) posted.push(r.url());
    });

    await page.goto("/?ui=web#/scan");
    await startCamera(page);
    await expect(page.getByTestId("engine")).toHaveText("Server");

    await page.getByTestId("capture").click();
    await page.getByRole("button", { name: /review 1/i }).click();

    expect(posted, "a connected device did not ask the server").not.toHaveLength(0);
    // Silent failover is the thing to guard against: it looks identical to the
    // server working until someone checks why accuracy never improved.
    await expect(page.getByTestId("via")).toContainText("On device");
  });

  test("does not resize the preview when a card is captured", async ({ page }) => {
    // The first version put results in the same column as the preview, so the
    // stage shrank on the first capture and the guide moved under the card the
    // user was still holding.
    await page.goto("/?ui=web#/scan");
    await startCamera(page);

    const capture = page.getByTestId("capture");
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
    await startCamera(page);
    const capture = page.getByTestId("capture");

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
    await startCamera(page);
    await page.getByTestId("capture").click();
    await page.getByRole("button", { name: /review 1/i }).click();

    await expect(page.getByRole("button", { name: "Nothing to add" })).toBeDisabled();
    await expect(page.getByText(/still needs? a choice/)).toBeVisible();
  });

  test("adds the batch once the unsure ones are answered", async ({ page }) => {
    await page.goto("/?ui=web#/scan");
    await startCamera(page);
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
    await startCamera(page);
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

  test("lets you name the card by hand when recognition got it wrong", async ({ page }) => {
    // The repair path for the 8.6% the gate refuses. It reads the index already
    // in memory, so it must work with no further network at all.
    await page.goto("/?ui=web#/scan");
    await startCamera(page);
    await page.getByTestId("capture").click();
    await page.getByRole("button", { name: /review 1/i }).click();

    // Recorded only while the picker is open. Choosing a card legitimately goes
    // on to fetch that set's printings for the finish chips; browsing 20,205
    // cards must not.
    const requests: string[] = [];
    const listener = (r: { url: () => string }) => requests.push(r.url());
    page.on("request", listener);

    await page.getByTestId("pick-by-set").click();
    const dialog = page.getByRole("dialog", { name: "Pick the card by set" });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("Set").selectOption("base1");
    await dialog.getByLabel("Filter by number or name").fill("Charizard");
    await expect(dialog.getByRole("button", { name: /Charizard/ })).toHaveCount(1);
    page.off("request", listener);

    await dialog
      .getByRole("button", { name: /Charizard/ })
      .first()
      .click();

    await expect(dialog).toBeHidden();
    const row = page.getByTestId("review-row").first();
    await expect(row).toContainText("Charizard");
    await expect(row).toContainText("named by hand");
    // A hand-named row is a decided row, so it becomes committable.
    await expect(page.getByRole("button", { name: /Add 1 card/ })).toBeEnabled();

    expect(
      requests.filter((u) => !u.startsWith("data:")),
      `browsing the picker went to the network: ${requests.join(", ")}`,
    ).toHaveLength(0);
  });

  test("captures on its own once a card holds still", async ({ page }) => {
    await page.goto("/?ui=web#/scan");
    await startCamera(page, { auto: true });

    // The fake device shows a moving pattern, so this asserts the loop is
    // running and reporting, not that it fires — firing on a rolling gradient
    // would mean the stability rule was broken.
    await expect(page.getByRole("button", { name: "Auto on" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("capture")).toContainText(
      /Hold still|Scanned|Next card|Scanning|Show a card/,
    );
  });

  test("can be turned off for one card at a time", async ({ page }) => {
    await page.goto("/?ui=web#/scan");
    await startCamera(page);
    await expect(page.getByRole("button", { name: "Auto off" })).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("capture")).toHaveText("Capture");
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

test.describe("the collector number on an unsettled row", () => {
  test("is shown when the scanner could not decide", async ({ page }) => {
    // 1,730 of 20,205 cards are reprints with identical artwork — the printed
    // number is the only thing that separates them. Rather than read it, which
    // needs OCR and adds a way to file the wrong card silently, the pixels go
    // in front of the person already being asked which card this is.
    await page.goto("/?ui=web#/scan");
    await startCamera(page);
    await page.getByTestId("capture").click();
    await page.getByRole("button", { name: /review 1/i }).click();

    const band = page.getByTestId("number-band");
    await expect(band).toBeVisible();

    // A real crop, not a 0x0 canvas that renders as nothing — the silent
    // early-return shape this codebase keeps being bitten by.
    const width = await band.evaluate((el) => (el as HTMLImageElement).naturalWidth);
    expect(width).toBeGreaterThan(0);
  });

  test("is cropped at camera resolution, not at the 245x342 the hash uses", async ({ page }) => {
    // The whole point. At 245x342 a collector number is about 8px tall; the
    // recognition canvas normalises to that size so resolution can never change
    // a hash, which is exactly why the band cannot be taken from it.
    await page.goto("/?ui=web#/scan");
    await startCamera(page);
    await page.getByTestId("capture").click();
    await page.getByRole("button", { name: /review 1/i }).click();

    const band = page.getByTestId("number-band");
    await expect(band).toBeVisible();
    const natural = await band.evaluate((el) => (el as HTMLImageElement).naturalWidth);
    expect(natural).toBeGreaterThan(245);
  });
});
