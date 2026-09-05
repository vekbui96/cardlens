import { expect, test, type Page, type Route } from "@playwright/test";
import { openV2, stabiliseForSnapshot, type OpenOptions } from "./pages/base.ts";

/**
 * The v2 scanner.
 *
 * There is no camera and there never will be one in CI, so none of this tries
 * to measure recognition. Accuracy is measured elsewhere, against real card art
 * (`scripts/measure-gate-safety.mjs`), and the auto-capture rules are measured
 * and unit-tested in `src/scan/autoCapture.test.ts`. What these check are the
 * DECISIONS this screen owns and that no amount of hash-quality measurement
 * would ever reveal:
 *
 *   - which recogniser answered, and whether the row admits it
 *   - that a rejected token does NOT quietly fall back to the device
 *   - that the capture leaves as a lossless PNG at the size the index was built
 *   - that ten rows from one set cost ONE printings request
 *   - that committing only ever ADDS
 *
 * Chromium's fake device supplies a moving synthetic pattern, which is enough
 * to exercise getUserMedia, the preview, the guide crop, the hash and the
 * number-band crop for real. `/api/recognize` is stubbed, because what is being
 * tested is what the screen does with each ANSWER, not the recogniser.
 */

test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

/** Matches the token the e2e API server is started with — see playwright.config.ts. */
const E2E_TOKEN = "e2e-token";

interface Candidate {
  cardId: string;
  name: string;
  setId: string;
  setName: string;
  collectorNumber: string;
  distance: number;
}

/** A reply in the shape `src/scan/remoteRecognize.ts` parses. */
function reply(status: "MATCHED" | "AMBIGUOUS" | "UNKNOWN", candidates: Candidate[], reason: string) {
  return {
    status,
    card: candidates[0] ?? null,
    confidence: 0.9,
    margin: 12,
    reason,
    candidates: candidates.map((c) => ({ ...c, artworkScore: 0.9 })),
    indexVersion: "e2e",
    processingTimeMs: 11,
  };
}

/**
 * Deliberately not real card ids.
 *
 * The screen resolves a server's card id against the on-device index when it
 * can, so a real id would make the assertion depend on the shipped index rather
 * than on the reply. These come back verbatim, which is the case that proves the
 * server can name a card the device has never heard of.
 */
const MEWTWO: Candidate = {
  cardId: "tst-10",
  name: "Testmon",
  setId: "tst",
  setName: "Testing Set",
  collectorNumber: "10",
  distance: 2,
};
const TWIN: Candidate = {
  ...MEWTWO,
  cardId: "tst2-10",
  setId: "tst2",
  setName: "Testing Set 2",
  distance: 4,
};
const THIRD: Candidate = {
  ...MEWTWO,
  cardId: "tst3-10",
  setId: "tst3",
  setName: "Testing Set 3",
  distance: 5,
};

/**
 * Open the scan screen.
 *
 * The router is a shared file this stream may not edit — the integrator adds
 * the one lazy import that reaches this screen. So the module request for it is
 * answered with a re-export of `scanHarness.ts` instead. Everything else is the
 * real app: real providers, real shell, real navigation, real dev server. See
 * that file for why this is the smallest possible lie.
 */
async function openScan(page: Page, options: OpenOptions & { printings?: string[] } = {}) {
  // Always stubbed, always last-registered so it wins: unstubbed, a set the
  // companion server has never heard of falls through to TCGdex directly and
  // puts the suite on the public internet.
  await stubPrintings(page, options.printings ?? []);
  await page.route("**/src/v2/V2Router.tsx*", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "application/javascript" },
      body: 'export { V2Router, ScreenSkeleton } from "/e2e/v2/scanHarness.ts";',
    }),
  );
  return openV2(page, "/scan", options);
}

/** Connect this device, the way Settings does. */
async function connectDevice(page: Page) {
  await page.addInitScript((token) => {
    localStorage.setItem(
      "cardlens:v1:sync-settings",
      JSON.stringify({ token, lastPushedAt: 0, lastPulledAt: 0, lastSyncAt: 0 }),
    );
  }, E2E_TOKEN);
}

/** Answer every recognition with the same verdict, and count the calls. */
async function stubRecogniser(page: Page, handler: (route: Route) => Promise<void> | void) {
  await page.route("**/api/recognize", handler);
}

/**
 * The printings oracle, stubbed and counted.
 *
 * Also keeps the suite off the network: unstubbed, a set the companion server
 * has never heard of falls through to TCGdex directly.
 */
async function stubPrintings(page: Page, seen: string[]) {
  await page.route("**/api/printings/**", (route) => {
    seen.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tcgdexSetId: "tst",
        byNumber: { "10": [{ type: "normal" }, { type: "reverse", foil: "pokeball" }] },
      }),
    });
  });
}

/**
 * Start the camera, with auto-capture off.
 *
 * The button being enabled is not enough: the index can be loaded while the
 * video still has no dimensions, and a capture then reads a 0x0 frame and
 * silently queues nothing. Auto is on by default and any test that counts
 * captures must not race the detection loop.
 */
async function startCamera(page: Page, { auto = false } = {}) {
  await page.getByRole("button", { name: "Start camera" }).click();
  if (!auto) await page.getByRole("button", { name: "Auto capture" }).click();
  await page.waitForFunction(
    () => {
      const v = document.querySelector("video");
      return Boolean(v && v.videoWidth > 0 && v.readyState >= 2);
    },
    { timeout: 20000 },
  );
  await expect(page.getByRole("button", { name: "Capture", exact: true })).toBeEnabled({ timeout: 20000 });
}

function rows(page: Page) {
  return page.getByRole("list", { name: "Scanned this batch" }).getByRole("listitem");
}

/* -------------------------------------------------------------------------- */

/**
 * v2 widths only.
 *
 * `playwright.config.ts` is shared and this stream may not edit it. Its `phone`
 * and `desktop` projects select by the regex `(...|scan|...)\.spec\.ts`, which
 * was written for v1's `e2e/scan.spec.ts` and matches this path too — so
 * without this guard the whole file also runs twice against the v1 projects,
 * which is two more runs of a camera suite for no extra coverage. Worth
 * reporting: any `e2e/v2/*.spec.ts` sharing a basename with a v1 spec is caught
 * the same way.
 */
// Playwright requires an object-destructuring first argument here.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("v2-"), "v2 projects only");
});

test.describe("which recogniser answered", () => {
  test("uses the server's verdict, and the row says the server gave it", async ({ page }) => {
    await connectDevice(page);
    const printings: string[] = [];
    await stubRecogniser(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(reply("MATCHED", [MEWTWO], "margin 12")),
      }),
    );

    await openScan(page, { printings });
    await startCamera(page);
    await page.getByRole("button", { name: "Capture", exact: true }).click();

    const row = rows(page).first();
    await expect(row).toContainText("Testmon");
    await expect(row).toContainText("Testing Set");
    // Provenance per row, not per session: the engine can change mid-batch.
    await expect(row.getByText("Server", { exact: true })).toBeVisible();
    await expect(row).toContainText("margin 12");
  });

  test("falls back to the device when the server cannot answer, and admits it", async ({ page }) => {
    await connectDevice(page);
    await stubRecogniser(page, (route) => route.fulfill({ status: 503, body: "down" }));

    await openScan(page);
    await startCamera(page);
    await page.getByRole("button", { name: "Capture", exact: true }).click();

    const row = rows(page).first();
    // A silent failover looks exactly like the server working until somebody
    // asks why accuracy never improved.
    await expect(row.getByText("On device", { exact: true })).toBeVisible();
    await expect(row).toContainText("recognised on this device");
  });

  test("a rejected token does NOT fall back to the device", async ({ page }) => {
    await connectDevice(page);
    await stubRecogniser(page, (route) => route.fulfill({ status: 401, body: "nope" }));

    await openScan(page);
    await startCamera(page);
    await page.getByRole("button", { name: "Capture", exact: true }).click();

    // The device could have answered. It deliberately did not: a refused token
    // is a broken connection, not a slow one, and filing a whole pile under a
    // recogniser the user did not choose would hide it.
    const row = rows(page).first();
    await expect(row).toContainText("The server refused this device");
    await expect(row.getByText("On device", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("alert")).toContainText("rejected this device");
    // And nothing else is captured until the user chooses.
    await expect(page.getByRole("button", { name: "Capture", exact: true })).toBeDisabled();

    await page.getByRole("button", { name: "Recognise on this device" }).click();
    await expect(page.getByRole("button", { name: "Capture", exact: true })).toBeEnabled();
  });

  test("an unconnected device never reaches the recogniser at all", async ({ page }) => {
    // Aeroplane mode is the case the on-device index exists for. It must not
    // merely cope with the network being gone — it must not ask.
    const asked: string[] = [];
    await page.route("**/api/recognize", (route) => {
      asked.push(route.request().url());
      return route.fulfill({ status: 200, body: "{}" });
    });

    await openScan(page);
    await startCamera(page);
    await page.getByRole("button", { name: "Capture", exact: true }).click();
    await expect(rows(page)).toHaveCount(1);

    expect(asked, `an unconnected device called the server: ${asked.join(", ")}`).toHaveLength(0);
    await expect(rows(page).first().getByText("On device", { exact: true })).toBeVisible();
  });
});

test.describe("what goes to the server", () => {
  test("a lossless PNG, at the size every index entry was built at", async ({ page }) => {
    // JPEG would put a plausible-looking discrepancy between two recognisers
    // that are supposed to be bit-identical, and a different size would change
    // the hash outright.
    await connectDevice(page);
    let png: { width: number; height: number; magic: boolean } | null = null;
    await stubRecogniser(page, (route) => {
      const body = route.request().postDataBuffer();
      if (body) {
        const at = body.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        if (at >= 0) {
          png = {
            magic: true,
            // IHDR: width and height are big-endian uint32 at +16 and +20.
            width: body.readUInt32BE(at + 16),
            height: body.readUInt32BE(at + 20),
          };
        }
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(reply("UNKNOWN", [], "no")),
      });
    });

    await openScan(page);
    await startCamera(page);
    await page.getByRole("button", { name: "Capture", exact: true }).click();
    // Wait for the ANSWER, not for the row. The row is queued the instant the
    // shutter fires — a round trip must never block it — so asserting on the
    // row alone races the request this test is about.
    await expect(rows(page).first()).toContainText("No match found");

    expect(png, "no PNG reached the recogniser").not.toBeNull();
    expect(png!).toEqual({ magic: true, width: 245, height: 342 });
  });
});

test.describe("the collector number", () => {
  test("is shown above the candidates when the artwork could not decide", async ({ page }) => {
    // 2,042 of 20,205 cards are reprints with identical art; the printed number
    // is the only thing that separates them. It is SHOWN, never read — reading
    // it needs OCR and adds a way to file the wrong card silently.
    await connectDevice(page);
    await stubRecogniser(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(reply("AMBIGUOUS", [MEWTWO, TWIN, THIRD], "two within 2 bits")),
      }),
    );

    await openScan(page);
    await startCamera(page);
    await page.getByRole("button", { name: "Capture", exact: true }).click();

    const row = rows(page).first();
    await expect(row).toContainText("Which one?");
    const band = row.getByTestId("number-band");
    await expect(band).toBeVisible();

    // A real crop at camera resolution, not a 0x0 canvas that renders as
    // nothing, and not the 245x342 the hash uses — at that size the number is
    // about 8px tall.
    const natural = await band.evaluate((el) => (el as HTMLImageElement).naturalWidth);
    expect(natural).toBeGreaterThan(245);

    // Under the question and ABOVE the answer: you read the number, then choose.
    const order = await row.evaluate((li) => {
      const img = li.querySelector("img[data-testid='number-band']");
      const group = li.querySelector("[role='group']");
      return img && group ? img.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING : 0;
    });
    expect(order, "the number band was rendered after the candidates").toBeGreaterThan(0);
  });

  test("is not a slab on a wide window", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "v2-desktop", "a width problem, at the width it happens");
    // It once rendered 1055x230 at 1440x900 and pushed the candidate buttons it
    // exists to be read WITH off the bottom of the window.
    await connectDevice(page);
    await stubRecogniser(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(reply("AMBIGUOUS", [MEWTWO, TWIN, THIRD], "ambiguous")),
      }),
    );

    await openScan(page);
    await startCamera(page);
    await page.getByRole("button", { name: "Capture", exact: true }).click();

    const row = rows(page).first();
    const band = await row.getByTestId("number-band").boundingBox();
    const group = await row.getByRole("group", { name: "Which card is this?" }).boundingBox();
    expect(band!.height).toBeLessThan(140);
    expect(band!.width).toBeLessThan(560);
    // And the thing it exists to be read beside is still on screen with it.
    expect(group!.y, "the candidates were pushed off the window by the band").toBeLessThan(900);
  });

  test("is released as soon as the row settles", async ({ page }) => {
    await connectDevice(page);
    const printings: string[] = [];
    await stubRecogniser(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(reply("MATCHED", [MEWTWO], "clear")),
      }),
    );

    await openScan(page, { printings });
    await startCamera(page);
    await page.getByRole("button", { name: "Capture", exact: true }).click();

    await expect(rows(page).first()).toContainText("Testmon");
    // A batch of thirty settled cards must not hold thirty full-resolution
    // crops it will never draw.
    await expect(rows(page).first().getByTestId("number-band")).toHaveCount(0);
  });
});

test.describe("the batch", () => {
  test("many rows from one set cost one printings request, not one each", async ({ page }) => {
    await connectDevice(page);
    const printings: string[] = [];
    await stubRecogniser(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(reply("MATCHED", [MEWTWO], "clear")),
      }),
    );

    await openScan(page, { printings });
    await startCamera(page);
    const capture = page.getByRole("button", { name: "Capture", exact: true });
    // Five in a row with no interruption — that is the whole point of a
    // scanner. The questions are asked at the end, over the batch.
    for (let i = 0; i < 5; i++) await capture.click();
    await expect(rows(page)).toHaveCount(5);
    await expect(rows(page).last()).toContainText("Testmon");

    // The finishes come from the oracle, not from a fixed Normal/Reverse pair.
    await expect(rows(page).first().getByRole("button", { name: "Poké Ball Reverse" })).toBeVisible();

    // Every request was for the one set, and the count does not scale with rows
    // — which is the property that matters: five rows, not five requests.
    expect(new Set(printings.map((u) => new URL(u).pathname))).toHaveProperty("size", 1);
    // Not exactly one: the dev build renders under React's StrictMode, which
    // mounts every effect twice. The first observer is torn down while its
    // request is in flight, React Query cancels it, and the remount refetches.
    // A production build makes exactly one. Two is the ceiling either way; a
    // per-row regression would show five.
    expect(printings.length, `one request per set, got ${printings.length}`).toBeLessThanOrEqual(2);
  });

  test("commits once, and never un-marks a card that is already owned", async ({ page }) => {
    // A pile being digitised overlaps what is already held. The first version of
    // this committed with a toggle, so scanning an owned card REMOVED it —
    // worst on the most complete sets, and silent.
    await connectDevice(page);
    await page.addInitScript(() => {
      localStorage.setItem(
        "cardlens:v1:collection",
        JSON.stringify([{ cardId: "tst-10", setId: "tst", finish: "normal", at: 1_700_000_000_000 }]),
      );
    });
    const printings: string[] = [];
    await stubRecogniser(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(reply("MATCHED", [MEWTWO], "clear")),
      }),
    );

    await openScan(page, { printings });
    await startCamera(page);
    await page.getByRole("button", { name: "Capture", exact: true }).click();
    await expect(rows(page).first()).toContainText("Testmon");

    await page.getByRole("button", { name: "Add 1 card" }).click();
    await expect(page.getByText("1 card added this session")).toBeVisible();

    const held = await page.evaluate(() => {
      const raw = localStorage.getItem("cardlens:v1:collection") ?? "[]";
      return (JSON.parse(raw) as { cardId: string; deletedAt?: number }[]).filter(
        (r) => r.cardId === "tst-10" && !r.deletedAt,
      ).length;
    });
    expect(held, "re-scanning an owned card removed it instead of keeping it").toBeGreaterThan(0);
  });

  test("will not file a row nobody decided", async ({ page }) => {
    await connectDevice(page);
    await stubRecogniser(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(reply("AMBIGUOUS", [MEWTWO, TWIN], "two within 2 bits")),
      }),
    );

    await openScan(page);
    await startCamera(page);
    await page.getByRole("button", { name: "Capture", exact: true }).click();

    await expect(page.getByRole("button", { name: "Nothing to add" })).toBeDisabled();
    await expect(page.getByText(/still needs a choice/)).toBeVisible();
  });

  test("does not resize the preview when a card is captured", async ({ page }) => {
    // The first version put results in the same column as the preview, so the
    // stage shrank on the first capture and the guide moved under the card the
    // user was still holding.
    await connectDevice(page);
    await stubRecogniser(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(reply("AMBIGUOUS", [MEWTWO, TWIN, THIRD], "ambiguous")),
      }),
    );

    await openScan(page);
    await startCamera(page);
    const video = page.locator("video");
    const before = await video.boundingBox();

    const capture = page.getByRole("button", { name: "Capture", exact: true });
    await capture.click();
    await capture.click();
    await expect(rows(page)).toHaveCount(2);

    const after = await video.boundingBox();
    expect(after!.height, "the preview shrank after capturing").toBeCloseTo(before!.height, 0);
    expect(after!.y, "the preview moved after capturing").toBeCloseTo(before!.y, 0);
  });
});

test.describe("the repair path", () => {
  test("names a card by hand, from the index, at no network cost", async ({ page }) => {
    // This is what the user reaches for when recognition has ALREADY gone
    // wrong, so it reads the index that is already in memory. A picker that
    // needed the network would be missing exactly when it is needed.
    await connectDevice(page);
    const printings: string[] = [];
    await stubRecogniser(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(reply("AMBIGUOUS", [MEWTWO, TWIN], "two within 2 bits")),
      }),
    );

    await openScan(page, { printings });
    await startCamera(page);
    await page.getByRole("button", { name: "Capture", exact: true }).click();
    await expect(rows(page).first()).toContainText("Which one?");

    const asked: string[] = [];
    const listener = (r: { url: () => string }) => {
      const url = r.url();
      if (!url.startsWith("data:")) asked.push(url);
    };
    page.on("request", listener);

    await rows(page).first().getByRole("button", { name: "Pick by set" }).click();
    const picker = page.getByRole("dialog", { name: "Pick the card by set" });
    await expect(picker).toBeVisible();
    await picker.getByLabel("Set", { exact: true }).selectOption("base1");
    await picker.getByLabel("Filter by number or name").fill("Charizard");
    await expect(picker.getByRole("button", { name: /Charizard/ })).toHaveCount(1);
    page.off("request", listener);

    expect(asked, `browsing 20,205 cards went to the network: ${asked.join(", ")}`).toHaveLength(0);

    await picker
      .getByRole("button", { name: /Charizard/ })
      .first()
      .click();
    await expect(picker).toBeHidden();

    const row = rows(page).first();
    await expect(row).toContainText("Charizard");
    await expect(row).toContainText("named by hand");
    // Beside the result, never over it — the candidates survive, so changing
    // your mind does not mean rescanning the card.
    await expect(row.getByRole("button", { name: "Change" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add 1 card" })).toBeEnabled();
  });
});

test.describe("when there is nothing to scan with", () => {
  test("says the browser has no camera API", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    });
    await openScan(page);
    await page.getByRole("button", { name: "Start camera" }).click();
    await expect(page.getByText("This browser has no camera API")).toBeVisible();
  });

  test("says the camera was blocked, and does not blame the user", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        value: () => {
          const err = new Error("denied");
          err.name = "NotAllowedError";
          return Promise.reject(err);
        },
        configurable: true,
      });
    });
    await openScan(page);
    await page.getByRole("button", { name: "Start camera" }).click();
    await expect(page.getByText(/Camera blocked \(NotAllowedError\)/)).toBeVisible();
  });

  test("says so when the card index cannot load, and offers a retry", async ({ page }) => {
    await page.route("**/card-index/**", (route) => route.fulfill({ status: 500, body: "no" }));
    await openScan(page);
    await expect(page.getByText("The card index could not load.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    // No server either, so the screen must not pretend it can identify anything.
    await expect(page.getByText(/Nothing on this device can identify a card/)).toBeVisible();
  });
});

test.describe("auto capture", () => {
  test("runs a detection loop and reports what it is waiting for", async ({ page }) => {
    // The fake device shows a rolling gradient, so this asserts the loop is
    // running and reporting — NOT that it fires. Firing on a moving pattern
    // would mean the stability rule was broken. The rules themselves (settled,
    // MIN_DETAIL >= 16, a new subject) are measured and unit-tested in
    // `src/scan/autoCapture.test.ts`; they are not this suite's to re-derive.
    await openScan(page);
    await startCamera(page, { auto: true });
    await expect(page.getByRole("button", { name: "Auto capture" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("status").first()).toContainText(
      /Hold still|Show a card|Scanned|Next card|Scanning/,
    );
  });

  test("pauses while the batch is being reviewed", async ({ page }) => {
    await openScan(page);
    await startCamera(page, { auto: true });
    await page.getByRole("button", { name: "Pause and review" }).click();
    await expect(page.getByRole("status").first()).toContainText("Paused while you review");
    await expect(page.getByRole("button", { name: "Keep scanning" })).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */

test.describe("scan @visual", () => {
  test("the screen before the camera starts", async ({ page }) => {
    await openScan(page);
    await expect(page.getByRole("heading", { name: "Scan", level: 1 })).toBeVisible();
    await expect(page.getByText(/cards indexed/)).toBeVisible();
    await stabiliseForSnapshot(page);
    await expect(page.getByRole("main")).toHaveScreenshot("scan-idle.png");
  });

  test("a batch waiting on a decision", async ({ page }) => {
    await connectDevice(page);
    const printings: string[] = [];
    await stubRecogniser(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(reply("AMBIGUOUS", [MEWTWO, TWIN, THIRD], "two within 2 bits")),
      }),
    );

    await openScan(page, { printings });
    await startCamera(page);
    const capture = page.getByRole("button", { name: "Capture", exact: true });
    await capture.click();
    await capture.click();
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).last()).toContainText("Which one?");

    await stabiliseForSnapshot(page);
    // The batch column alone: the viewfinder beside it is a live camera and
    // differs on every frame, which says nothing about the layout.
    await expect(page.getByRole("list", { name: "Scanned this batch" })).toHaveScreenshot("scan-batch.png");
  });
});
