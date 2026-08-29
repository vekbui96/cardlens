import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Desktop is a real target, not a wide phone.
 *
 * These assertions are about using the space, not about appearance: a 1440px
 * window must show a multi-column grid rather than a 760px letterbox, and the
 * card sheet must be a side panel rather than a short strip pinned to the
 * furthest point from the cursor.
 *
 * Follows the phone project's conventions — see e2e/phone-layout.spec.ts for
 * why the sets list renders role="option" rows and why the printings route is
 * stubbed to stress the sheet.
 */

/**
 * The fake camera, for the scan-review block at the bottom of this file.
 *
 * It has to be declared file-wide: `launchOptions` forces a new worker, so
 * Playwright refuses it inside a describe. It costs the other blocks nothing —
 * the args only mean anything to a page that calls getUserMedia.
 */
test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

test.describe("web shell at desktop size", () => {
  // Playwright requires an object-destructuring first argument here.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop project only");
  });

  test("a large window is not letterboxed into a phone column", async ({ page }) => {
    await page.goto("/?ui=web#/sets");
    const shell = page.locator("#root > div");
    await expect(shell).toBeVisible();

    const box = await shell.boundingBox();
    // The old default capped every viewport at 760px. Anything at or below that
    // means desktop is still being treated as a phone.
    expect(box!.width, "shell width at 1440px").toBeGreaterThan(900);
  });

  test("the set grid uses the width with more than one column", async ({ page }) => {
    await page.goto("/?ui=web#/sets");
    await page
      .getByRole("button", { name: /Obsidian Flames/ })
      .first()
      .click();

    const tiles = page.getByRole("button", { name: /, (not )?owned$/ });
    await expect(tiles.first()).toBeVisible();

    const count = await tiles.count();
    expect(count, "no card tiles rendered").toBeGreaterThan(1);

    // Same row => same y. A single-column grid would stack them instead.
    const first = await tiles.nth(0).boundingBox();
    const second = await tiles.nth(1).boundingBox();
    expect(Math.abs(first!.y - second!.y), "tiles should sit side by side").toBeLessThan(4);
    expect(second!.x, "second tile should be to the right of the first").toBeGreaterThan(first!.x);
  });

  test("a card tile keeps its shape when the art fails to load", async ({ page }) => {
    // Found by screenshot: a 404 left the tile as a floating number and tick
    // with no box, because the placeholder has no intrinsic height. Two cells
    // of a nine-card page collapsed and the row lost its shape.
    await page.route("**/images.pokemontcg.io/**", (r) => r.abort());

    await page.goto("/?ui=web#/sets");
    await page
      .getByRole("button", { name: /Obsidian Flames/ })
      .first()
      .click();

    const tile = page.getByRole("button", { name: /, (not )?owned$/ }).first();
    await expect(tile).toBeVisible();

    const box = await tile.boundingBox();
    expect(box!.height, "tile collapsed when its image failed").toBeGreaterThan(100);
  });

  test("no horizontal overflow at desktop width", async ({ page }) => {
    await page.goto("/?ui=web#/sets");
    await page
      .getByRole("button", { name: /Obsidian Flames/ })
      .first()
      .click();
    await expect(page.getByRole("list")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("the card sheet is a full-height side panel, and Done stays reachable", async ({ page }) => {
    // The mock fixtures give each card one printing, so a real card cannot
    // stress the panel's height. See phone-layout.spec.ts for why routing
    // /api/printings controls what the sheet renders.
    const manyFinishes = [
      { type: "normal" },
      { type: "reverse" },
      { type: "holo" },
      { type: "firstEdition" },
      { type: "shadowless" },
      { type: "reverse", foil: "pokeball" },
      { type: "reverse", foil: "masterball" },
      { type: "reverse", foil: "energy" },
      { type: "reverse", foil: "friendball" },
      { type: "reverse", foil: "loveball" },
      { type: "reverse", foil: "quickball" },
      { type: "holo", foil: "tinsel" },
    ];
    await page.route("**/api/printings/**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          tcgdexSetId: "sv3",
          byNumber: { "125": manyFinishes, "223": manyFinishes },
        }),
      });
    });

    await page.goto("/?ui=web#/sets");
    await page
      .getByRole("button", { name: /Obsidian Flames/ })
      .first()
      .click();
    await page
      .getByRole("button", { name: /^Details for / })
      .first()
      .click();

    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();

    const box = await sheet.boundingBox();
    const viewport = page.viewportSize()!;

    // Anchored right, using the full height — not a short strip along the bottom.
    expect(box!.x + box!.width, "panel should meet the right edge").toBeGreaterThanOrEqual(
      viewport.width - 2,
    );
    expect(box!.height, "panel should use the full height").toBeGreaterThan(viewport.height * 0.9);
    expect(box!.width, "panel should not swallow the page").toBeLessThan(viewport.width / 2);

    // Height-bounded and Done-reachable are different properties; assert both.
    const closeBox = await sheet.getByRole("button", { name: "Done" }).boundingBox();
    expect(closeBox, "Done button has no box").not.toBeNull();
    expect(
      closeBox!.y + closeBox!.height,
      "Done must be reachable without scrolling the panel",
    ).toBeLessThanOrEqual(box!.y + box!.height + 1);
  });
});

/**
 * The binder at desktop size.
 *
 * A real card is 63x88mm, which is 238x333 CSS px at the 96dpi a CSS pixel is
 * defined against. LIFE_SIZE_W is that number, and it is the ceiling every
 * assertion here is written against: a pocket drawn at or above it is a card
 * rendered bigger than the one in your hand, which reads as a bug rather than
 * as a big card.
 *
 * Binders are web-only and live in the phone project everywhere else (see
 * e2e/binders.spec.ts); these are the desktop-shaped questions the phone cannot
 * ask, so they live here, in the one spec the desktop project matches.
 */
const LIFE_SIZE_W = 238;

test.describe("the binder at desktop size", () => {
  // Playwright requires an object-destructuring first argument here.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop project only");
  });

  /** A fresh binder with `pages` pages, opened. */
  async function openBinder(page: import("@playwright/test").Page, pages = 1) {
    await page.goto("/?ui=web#/binders");
    await page.getByLabel("Binder name").fill("Desktop binder");
    await page.getByRole("button", { name: "Create binder" }).click();
    await expect(page.getByRole("button", { name: /Pocket 1, empty/ }).first()).toBeVisible();
    for (let i = 1; i < pages; i++) await page.getByRole("button", { name: "Add page" }).click();
    await expect(page.getByRole("region", { name: /^Page / })).toHaveCount(pages);
  }

  test("the toolbar is one row, not a column down the left edge", async ({ page }) => {
    // Screen's body is a column flex container, so the toolbar's three groups —
    // page actions, Settings, and the set picker with Fill — were three lines.
    // Measured at 1440px before the fix: three rows of chrome about 700px wide
    // in total, occupying a tenth of the width and pushing the binder down.
    await openBinder(page);

    const boxes = await Promise.all(
      ["Add page", "Settings", "Fill with one of each"].map((name) =>
        page.getByRole("button", { name, exact: true }).boundingBox(),
      ),
    );
    for (const box of boxes) expect(box, "a toolbar control has no box").not.toBeNull();

    const ys = boxes.map((b) => b!.y);
    expect(Math.max(...ys) - Math.min(...ys), "toolbar controls are on different rows").toBeLessThan(4);

    // And they are laid out left to right, not stacked in place.
    expect(boxes[2]!.x, "the set picker should follow Settings across").toBeGreaterThan(boxes[1]!.x);
  });

  test("a pocket stays smaller than the card it is holding", async ({ page }) => {
    // Two 1fr columns across the 1180px shell drew a 9-pocket page's pockets at
    // 177x248 — three quarters of life size, nine at a time.
    await openBinder(page);

    const pocket = await page
      .getByRole("button", { name: /Pocket 1, empty/ })
      .first()
      .boundingBox();
    expect(pocket, "pocket 1 has no box").not.toBeNull();
    expect(pocket!.width, "a pocket must read as a card, not a poster").toBeLessThan(LIFE_SIZE_W * 0.7);
    // The floor matters as much: a page squeezed into a column is the phone bug
    // that e2e/binders.spec.ts guards, and it would satisfy the cap above.
    expect(pocket!.width, "pockets collapsed").toBeGreaterThan(100);
  });

  test("the width goes to the facing pages", async ({ page }) => {
    // The point of a wide window in a binder is the SPREAD — two pages open at
    // once — not one page drawn larger.
    await openBinder(page, 3);

    const left = await page.getByLabel("Page 2").boundingBox();
    const right = await page.getByLabel("Page 3").boundingBox();
    expect(Math.abs(left!.y - right!.y), "pages 2 and 3 should face each other").toBeLessThan(4);
    expect(right!.x, "page 3 should sit right of page 2").toBeGreaterThan(left!.x + left!.width);
    expect(left!.width, "a page is capped so its pockets stay card-sized").toBeLessThanOrEqual(460);
  });

  test("the opening page opens against a drawn inside front cover", async ({ page }) => {
    // Page 1 sits in the right-hand column because that is where a binder falls
    // open. Left as a bare grid track that was 550px of nothing down the left of
    // a 1440px window — indistinguishable from a page that failed to render. The
    // column is now drawn as the cover leaf it represents.
    await openBinder(page);

    const spread = page.locator("[data-cover]");
    await expect(spread).toBeVisible();
    const page1 = await page.getByRole("region", { name: "Page 1" }).boundingBox();
    const viewport = page.viewportSize()!;

    // The spine of a centred spread falls on the middle of the window, so page
    // 1's left edge is within half a gutter of it.
    expect(
      Math.abs(page1!.x - viewport.width / 2),
      "page 1 should start at the middle of the window",
    ).toBeLessThan(40);

    // The leaf is a pseudo-element, so it has no box to locate — read it off the
    // spread. `content: none` means the rule never applied and the half-screen
    // is still empty.
    const leaf = await spread.evaluate((el) => {
      const s = getComputedStyle(el, "::after");
      return { content: s.content, width: parseFloat(s.width), left: parseFloat(s.left) };
    });
    expect(leaf.content, "the inside front cover is not drawn at all").not.toBe("none");
    expect(leaf.width, "the cover should be a page's width").toBeCloseTo(page1!.width, 0);
    // Immediately left of page 1, across the gutter — it is the facing page.
    const spreadBox = (await spread.boundingBox())!;
    expect(spreadBox.x + leaf.left + leaf.width, "the cover should meet the gutter").toBeLessThan(page1!.x);
    expect(spreadBox.x + leaf.left + leaf.width, "the cover should touch the gutter").toBeGreaterThan(
      page1!.x - 30,
    );
  });

  test("no horizontal overflow on the binder at desktop width", async ({ page }) => {
    await openBinder(page, 3);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

/**
 * The trade page draws the same binder the builder does.
 *
 * BinderPage is shared and the spread geometry is duplicated in both
 * stylesheets on purpose (see TradeShareScreen.module.css), which is exactly
 * the arrangement that drifts. This is the assertion that catches it.
 */
test.describe("the trade page at desktop size", () => {
  // Playwright requires an object-destructuring first argument here.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop project only");
  });

  /** Matches the token the e2e API server is started with — see playwright.config.ts. */
  const E2E_TOKEN = "e2e-token";
  const API = "http://localhost:8787/api";

  async function shareTradeBinder(request: APIRequestContext, id: string) {
    const now = Date.now();
    const slot = {
      kind: "card",
      cardId: "sv3-1",
      finish: "normal",
      collectorNumber: "1",
      name: "Charmander",
    };
    const push = await request.post(`${API}/binders/merge`, {
      headers: { authorization: `Bearer ${E2E_TOKEN}` },
      data: {
        binders: [
          {
            id,
            name: "Spares and dupes",
            format: "9",
            forTrade: true,
            createdAt: now,
            updatedAt: now,
            pages: [{ slots: { 0: slot } }, { slots: {} }, { slots: {} }],
          },
        ],
      },
    });
    expect(push.ok()).toBeTruthy();
    const share = await request.post(`${API}/share/binder`, {
      headers: { authorization: `Bearer ${E2E_TOKEN}` },
      data: { binderId: id },
    });
    expect(share.ok()).toBeTruthy();
    return (await share.json()).id as string;
  }

  test("shows the same capped, centred spread as the builder", async ({ page, request }) => {
    const shareId = await shareTradeBinder(request, `desktop-trade-${Date.now()}`);
    await page.goto(`/?ui=web#/trade/${shareId}`);
    await expect(page.getByRole("heading", { name: "Spares and dupes" })).toBeVisible();

    const page1 = await page.getByRole("region", { name: "Page 1" }).boundingBox();
    const viewport = page.viewportSize()!;
    expect(page1!.width, "a trade page is capped like a builder page").toBeLessThanOrEqual(460);
    expect(
      Math.abs(page1!.x - viewport.width / 2),
      "page 1 should start at the middle of the window",
    ).toBeLessThan(40);

    const pocket = await page.getByLabel(/^Page 1, Pocket 1,/).boundingBox();
    expect(pocket!.width, "a pocket must read as a card, not a poster").toBeLessThan(LIFE_SIZE_W * 0.7);

    // Pages 2 and 3 face each other, so the width is spent on the spread here too.
    const left = await page.getByRole("region", { name: "Page 2" }).boundingBox();
    const right = await page.getByRole("region", { name: "Page 3" }).boundingBox();
    expect(Math.abs(left!.y - right!.y), "pages 2 and 3 should face each other").toBeLessThan(4);
    expect(right!.x).toBeGreaterThan(left!.x + left!.width);
  });
});

/**
 * The screens that never opted into the desktop breakpoint.
 *
 * Seven stylesheets already had a `@media (min-width: 1000px)` block; these did
 * not, and each number below is one that was MEASURED at 1440x900 before the
 * rule that fixes it existed — not a preference about how the page should look.
 */

/** Two sets, so the value panel has something to list and both are "in progress". */
const HELD = [
  { cardId: "sv3-223", setId: "sv3", finish: "normal", at: 1_700_000_000_000 },
  { cardId: "base1-58", setId: "base1", finish: "normal", at: 1_700_000_001_000 },
];

/** Every set row carries "<name>, N cards tracked" — or "N of M cards" once a set has a total. */
const SET_ROW = /, \d+ (of \d+ )?cards( tracked)?$/;

test.describe("collection at desktop size", () => {
  // Playwright requires an object-destructuring first argument here.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop project only");
  });

  test("the set list spends the width on columns, not on the gap inside a row", async ({ page }) => {
    // Two fixed columns put a 72px logo and a short name at opposite ends of a
    // 564px row, with ~220px of nothing between them. Three columns is what the
    // content of the row asks for at the full 1180px shell.
    await page.goto("/?ui=web#/collection");

    const rows = page.getByRole("button", { name: SET_ROW });
    await expect(rows.first()).toBeVisible();
    expect(await rows.count(), "not enough sets to tell a grid from a list").toBeGreaterThan(3);

    const first = await rows.nth(0).boundingBox();
    const second = await rows.nth(1).boundingBox();
    const third = await rows.nth(2).boundingBox();
    const fourth = await rows.nth(3).boundingBox();

    // Same y => same grid row.
    expect(Math.abs(first!.y - second!.y), "rows 1 and 2 should sit side by side").toBeLessThan(4);
    expect(Math.abs(first!.y - third!.y), "row 3 should be on that row too").toBeLessThan(4);
    expect(second!.x).toBeGreaterThan(first!.x);
    expect(third!.x).toBeGreaterThan(second!.x);
    // ...and only three: a fourth on the same line would mean the name had been
    // squeezed to an ellipsis to fit.
    expect(fourth!.y, "the row should wrap after three").toBeGreaterThan(first!.y);

    // The 72px floor is a thumb target the pointer does not need, and the
    // content of the row is 56px.
    expect(first!.height, "row is taller than its content needs").toBeLessThan(72);
  });

  test("the value panel lines up with the set list, and pairs a set with its value", async ({ page }) => {
    await page.addInitScript((rows) => {
      localStorage.setItem("cardlens:v1:collection", JSON.stringify(rows));
    }, HELD);
    await page.goto("/?ui=web#/collection");

    const panel = page.getByRole("region", { name: "Collection value" });
    await expect(panel).toBeVisible();
    const rows = page.getByRole("button", { name: SET_ROW });
    await expect(rows.first()).toBeVisible();

    // The panel kept the phone --cl-gap inset while everything below it moved
    // to --cl-gap-lg, so it sat 8px proud of the list it introduces.
    const panelBox = await panel.boundingBox();
    const rowBox = await rows.first().boundingBox();
    expect(Math.abs(panelBox!.x - rowBox!.x), "panel and set list should share a left edge").toBeLessThan(2);

    // Its rows are a name and two numbers. One per line across 1100px left
    // ~900px between the set and its value, which is a long way to track a
    // blank line to pair two things.
    const items = panel.getByRole("listitem");
    expect(await items.count(), "need two sets to tell one column from two").toBeGreaterThan(1);
    const a = await items.nth(0).boundingBox();
    const b = await items.nth(1).boundingBox();
    expect(Math.abs(a!.y - b!.y), "the panel set rows should sit side by side").toBeLessThan(4);
    expect(b!.x).toBeGreaterThan(a!.x);
  });
});

test.describe("showcase at desktop size", () => {
  // Playwright requires an object-destructuring first argument here.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop project only");
  });

  test("a pocket is filled by its card, not by a stamp in the corner", async ({ page, context }) => {
    // CardImage hard-codes a 54x76 thumb, and `.tile img { width: 100% }` in
    // the showcase only ever meant 100% of that — so a 380px pocket held 54px
    // of card and ~86% empty space. The share page is the one screen a stranger
    // sees, which makes it the worst place for it.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript((rows) => {
      localStorage.setItem("cardlens:v1:collection", JSON.stringify(rows));
    }, HELD);

    await page.goto("/?ui=web#/set/sv3/Obsidian%20Flames");
    await expect(page.getByRole("button", { name: /, (not )?owned$/ }).first()).toBeVisible();
    await page.getByRole("button", { name: "Share" }).click();
    const url = await page.evaluate(() => navigator.clipboard.readText());
    await page.goto(url.replace(/^https?:\/\/[^/]+/, ""));

    const slot = page.getByTestId("showcase-slot").first();
    await expect(slot).toBeVisible();
    const slotBox = await slot.boundingBox();
    const artBox = await slot.locator("img").first().boundingBox();
    expect(artBox!.width / slotBox!.width, "art should fill its pocket").toBeGreaterThan(0.9);

    // Three across is deliberate, so the width goes into the cards rather than
    // into more of them — but a 360px card is half again the size of the real
    // thing, and a nine-card page then runs to some 1600px of scroll.
    expect(artBox!.width, "a pocket should still read as a card").toBeLessThan(300);
  });
});

test.describe("target at desktop size", () => {
  // Playwright requires an object-destructuring first argument here.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop project only");
  });

  test("the connect form is a form, not a page-wide banner", async ({ page }) => {
    // An 8-digit TCIN and a token, in a 1130px single-line field with a 1130px
    // button under it — the eye had to cross the whole window to get from what
    // it typed to the control that submits it.
    await page.goto("/?ui=web#/target");

    const form = page.locator("form");
    await expect(form).toBeVisible();
    const formBox = await form.boundingBox();
    const shellBox = await page.locator("#root > div").boundingBox();
    expect(formBox!.width, "the form should not span the shell").toBeLessThan(shellBox!.width * 0.7);
  });
});

test.describe("scan review at desktop size", () => {
  // The fake camera these need is declared at the top of the file — see there
  // for why it cannot live in this describe.

  // Playwright requires an object-destructuring first argument here.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop project only");
  });

  test("decisions sit two across, and the number band is not a slab", async ({ page }) => {
    await page.goto("/?ui=web#/scan");
    await page.getByRole("button", { name: "Start camera" }).click();
    // Auto is on by default and would race the capture count.
    await page.getByRole("button", { name: "Auto on" }).click();
    await expect(page.getByTestId("capture")).toBeEnabled({ timeout: 20000 });
    // Enabled is not ready: a capture taken before the video has dimensions
    // reads a 0x0 frame and queues nothing.
    await page.waitForFunction(
      () => {
        const v = document.querySelector("video");
        return Boolean(v && v.videoWidth > 0 && v.readyState >= 2);
      },
      { timeout: 20000 },
    );

    for (let i = 0; i < 2; i++) {
      await page.getByTestId("capture").click();
      // The shutter only re-arms on a NEW subject, so the captures are spaced.
      await page.waitForTimeout(700);
    }
    await page.getByRole("button", { name: /^Done/ }).click();

    const rows = page.getByRole("listitem");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count(), "two captures should produce two rows").toBeGreaterThan(1);

    const first = await rows.nth(0).boundingBox();
    const second = await rows.nth(1).boundingBox();
    expect(Math.abs(first!.y - second!.y), "two decisions should sit side by side").toBeLessThan(4);
    expect(second!.x).toBeGreaterThan(first!.x);

    // The band is a photograph of the bottom sixth of a card, roughly 4.5:1. At
    // width:100% of a full-width row it rendered 1055x230 and pushed the
    // candidates it exists to be read WITH off the bottom of the window, so
    // only one row was ever on screen. The fake device is a rolling pattern
    // rather than a card, so a row settling confidently — and dropping its
    // band — is a legitimate outcome and not a failure.
    const band = page.getByTestId("number-band").first();
    if (await band.isVisible()) {
      const bandBox = await band.boundingBox();
      expect(bandBox!.height, "the number band should not be a slab").toBeLessThan(140);
    }
  });
});
