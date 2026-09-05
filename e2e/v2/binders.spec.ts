import { expect, test, type Page } from "@playwright/test";
import { openV2, stabiliseForSnapshot, type OpenOptions } from "./pages/base.ts";

/**
 * The shelf, driven the way a person drives it.
 *
 * `?seed=binders` puts three binders in storage: a full 9-pocket one that was
 * given a cover, a nearly-empty 12-pocket one, and an empty 9-pocket one. That
 * spread is deliberate — it is exactly the three cases the tile has to tell
 * apart by sight, and the two formats are what the width assertions need.
 *
 * ## Why several of these measure pixels
 *
 * Everything about behaviour is selected by role and accessible name, like the
 * rest of the suite. But three of this screen's acceptance criteria are
 * geometric — one fixed cover height, a 12-pocket cover visibly wider than a
 * 9-pocket one, and every tile in a row the same height — and each of them
 * regressed in v1 at some point without a single assertion noticing. A bounding
 * box has no role, so those read `data-` attributes the screen sets for exactly
 * this purpose.
 */

/**
 * Open the shelf, or skip.
 *
 * The router entry for this screen is not a stream's to write — `V2Router.tsx`
 * is shared, and nine streams each editing it is nine merge conflicts (see
 * `docs/v2/STREAM-BRIEF.md` §1). Until the integrator adds that one line,
 * `#/binders` renders the "Not built yet" placeholder and there is nothing here
 * to drive. Saying so is honest; failing would report a bug that is not one,
 * and passing on a placeholder would be worse.
 */
async function openShelf(page: Page, options: OpenOptions = { seed: "binders" }): Promise<void> {
  await openV2(page, "/binders", options);
  const placeholder = await page.getByText("Not built yet").count();
  test.skip(placeholder > 0, "V2Router does not route #/binders to BindersScreen yet");
  await expect(page.getByRole("heading", { name: "Binders", level: 1 })).toBeVisible();
}

/** The tile for a binder, by the id the fixture gave it. */
function tile(page: Page, id: string) {
  return page.locator(`[data-binder-tile="${id}"]`);
}

test.describe("finding a binder", () => {
  test("every binder is a tile that says what it is in words", async ({ page }) => {
    // The art is decorative in full, so the button's name is the whole of what
    // a screen reader gets. It has to answer the same question the picture
    // does: which binder, what shape, how far along.
    await openShelf(page);

    await expect(page.getByRole("button", { name: "Jolteon, 9-pocket, 27 of 27" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Showcase, 12-pocket, 1 of 36" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Destined rivals, 9-pocket, 0 of 9" })).toBeVisible();
  });

  test("the whole tile opens the binder", async ({ page }) => {
    await openShelf(page);
    await page.getByRole("button", { name: "Jolteon, 9-pocket" }).click();
    expect(page.url()).toContain("#/binder/fx-full");
  });

  test("the shelf says what it holds", async ({ page }) => {
    // Cards rather than binders: six binders is a number that stops meaning
    // anything, and the cards are the collection.
    await openShelf(page);
    await expect(page.getByText("3 binders · 28 cards")).toBeVisible();
  });

  test("no card art is offered to a screen reader", async ({ page }) => {
    /*
     * A 12-pocket shelf of six binders is seventy-two thumbnails, none of which
     * can be acted on and none of which says anything the tile's button has not
     * already said. `getByRole("img")` must find NOTHING on this screen.
     */
    await openShelf(page);
    await expect(page.getByRole("img")).toHaveCount(0);
  });
});

test.describe("the shelf is a shelf", () => {
  test("every cover is the same height, whatever format is in it", async ({ page }) => {
    /*
     * Real binders stand the same height whatever is filed in them, and this is
     * also what makes the `auto-fill` grid safe: while the cover took its
     * height from the column width, the shelf jumped a row taller mid-resize.
     *
     * Measured on the drawn cover, not on the box around it. A frame with a
     * fixed height can still hold a page that a `max-width` has squeezed —
     * which loses height, silently, and only for the widest format.
     */
    await openShelf(page);
    const heights = await page
      .locator("[data-cover]")
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));

    // One chosen cover and two page mosaics, all the same height.
    expect(heights.length).toBe(3);
    expect(new Set(heights).size).toBe(1);
    expect(await page.locator("[data-cover-frame]").count()).toBe(3);
  });

  test("a 12-pocket cover is visibly wider than a 9-pocket one", async ({ page }) => {
    // Four cards across against three. At one height, width is the only thing
    // left to say so — and it is the difference between the formats.
    await openShelf(page);
    const wide = await page.locator('[data-page-format="12"]').first().boundingBox();
    const narrow = await page.locator('[data-page-format="9"]').first().boundingBox();

    expect(wide!.width).toBeGreaterThan(narrow!.width * 1.2);
    expect(Math.round(wide!.height)).toBe(Math.round(narrow!.height));
  });

  test("every tile in a row is the same height", async ({ page }) => {
    await openShelf(page);
    const boxes = await page
      .locator("[data-binder-tile]")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => [r.top, r.height]));

    // Group by row, then assert one height per row. At 390 the shelf is two
    // columns and at 1440 it is one row of three, so this covers both shapes
    // without knowing which it got.
    const rows = new Map<number, Set<number>>();
    for (const [top, height] of boxes) {
      const key = Math.round(top);
      if (!rows.has(key)) rows.set(key, new Set());
      rows.get(key)!.add(Math.round(height));
    }
    for (const heights of rows.values()) expect(heights.size).toBe(1);
  });
});

test.describe("the art costs nothing", () => {
  test("no image is fetched that is not on a tile already rendered", async ({ page }) => {
    /*
     * `CardSlot` carries `imageSmall` denormalised, so the shelf needs no
     * catalog call to know what its binders look like. What it must also not do
     * is speculatively fetch: every image request has to correspond to an
     * `<img>` the page actually put on a tile, and every one of them has to be
     * lazy so the ones below the fold cost nothing until they are scrolled to.
     */
    const requested: string[] = [];
    page.on("request", (r) => {
      if (r.resourceType() === "image") requested.push(r.url());
    });

    await openShelf(page);
    await page.waitForLoadState("networkidle");

    const rendered = await page.locator("img").evaluateAll((els) =>
      els.map((el) => ({
        src: (el as HTMLImageElement).getAttribute("src") ?? "",
        loading: el.getAttribute("loading"),
      })),
    );

    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.every((img) => img.loading === "lazy")).toBe(true);

    // Card art is the only thing this screen fetches off-origin; the dev
    // server's own assets are not what the budget is about.
    const origin = new URL(page.url()).origin;
    const art = requested.filter((url) => new URL(url).origin !== origin);
    expect(art.length).toBeLessThanOrEqual(rendered.length);
    for (const url of art) {
      expect(rendered.some((img) => img.src === url)).toBe(true);
    }
  });

  test("a binder given a cover shows the cover, not a page from inside it", async ({ page }) => {
    // Setting a cover is a deliberate statement about what a binder is. Seeing
    // it before you open the binder is the entire point.
    await openShelf(page);
    await expect(tile(page, "fx-full").locator("[data-page-format]")).toHaveCount(0);
    await expect(tile(page, "fx-full").locator("img")).toHaveCount(1);

    // Drawn as the one card it is. It is a flex item whose width would
    // otherwise come from its own content, and that circularity once rendered a
    // Pokémon card 159 wide by 134 tall — landscape.
    const box = (await tile(page, "fx-full").locator('[data-cover="card"]').boundingBox())!;
    expect(box.width / box.height).toBeCloseTo(5 / 7, 2);
  });

  test("a binder with no cover shows a real page from it, gaps and all", async ({ page }) => {
    await openShelf(page);
    await expect(tile(page, "fx-sparse").locator('[data-page-format="12"]')).toBeVisible();
    // One card on the page it shows; the other eleven pockets are honest gaps.
    await expect(tile(page, "fx-sparse").locator("img")).toHaveCount(1);
  });
});

test.describe("deleting a binder", () => {
  test("one press never deletes", async ({ page }) => {
    /*
     * The delete writes a tombstone precisely so the deletion survives a sync,
     * which means a misclick reaches every device and cannot be undone. A
     * binder is also an evening of arrangement.
     */
    await openShelf(page);
    await page.getByRole("button", { name: "Delete Showcase", exact: true }).click();

    await expect(tile(page, "fx-sparse")).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm delete Showcase", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Keep Showcase", exact: true }).click();
    await expect(page.getByRole("button", { name: "Confirm delete Showcase", exact: true })).toHaveCount(0);
    await expect(tile(page, "fx-sparse")).toBeVisible();
  });

  test("two presses delete it, and it asks over the binder it is about", async ({ page }) => {
    await openShelf(page);
    await page.getByRole("button", { name: "Delete Showcase", exact: true }).click();
    await expect(page.getByRole("group", { name: "Delete Showcase?" })).toBeVisible();
    await page.getByRole("button", { name: "Confirm delete Showcase", exact: true }).click();

    await expect(tile(page, "fx-sparse")).toHaveCount(0);
    // The other two are untouched — nothing else on the shelf is disturbed.
    await expect(tile(page, "fx-full")).toBeVisible();
    await expect(tile(page, "fx-empty")).toBeVisible();
  });
});

test.describe("making one", () => {
  test("with no binders at all, the create tile is the whole screen", async ({ page }) => {
    // It is its own empty state: last on the shelf, shaped like a binder, and
    // the only thing there when the shelf is empty.
    await openShelf(page, { seed: "empty" });

    await expect(page.getByRole("button", { name: "Create binder" })).toBeVisible();
    await expect(page.locator("[data-binder-tile]")).toHaveCount(0);
    await expect(page.getByText(/0 binders/)).toHaveCount(0);
  });

  test("naming one and picking a format opens it", async ({ page }) => {
    await openShelf(page, { seed: "empty" });

    await page.getByLabel("Binder name").fill("Master set");
    await page.getByRole("button", { name: "12-pocket" }).click();
    await page.getByRole("button", { name: "Create binder" }).click();

    // Creating a binder is never the goal; filling it is.
    expect(page.url()).toContain("#/binder/");
  });
});

/**
 * One snapshot, at both project widths.
 *
 * The shelf is the screen most likely to be broken by somebody else's change to
 * a shared primitive — it uses `Card`, `CardArt`, `Meter`, `Chip`, `Money` and
 * `Grid` all at once, and a padding changed to suit another screen shows up
 * here first. `stabiliseForSnapshot` hides the card art, which comes over the
 * network from a third-party CDN and is a difference in pixels that says
 * nothing about the code.
 *
 * The whole page rather than the `main` landmark alone, which is what a screen
 * would rather snapshot: the header is `position: sticky`, so once the page is
 * long enough to scroll — which it is at 390px — scrolling `main` into view
 * puts the header ON TOP of its first 56px and the screen's own heading
 * disappears from its own baseline.
 */
test.describe("binders @visual", () => {
  test("the shelf looks like itself", async ({ page }) => {
    await openShelf(page);
    await stabiliseForSnapshot(page);
    await expect(page).toHaveScreenshot("shelf.png", { fullPage: true });
  });
});
