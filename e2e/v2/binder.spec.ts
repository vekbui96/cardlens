import { expect, test, type Page } from "@playwright/test";
import { openV2, stabiliseForSnapshot } from "./pages/base.ts";

/**
 * The binder builder, from `docs/v2/specs/05-binder.md`.
 *
 * Runs at 390 and 1440 automatically — see the `v2-phone` and `v2-desktop`
 * projects in playwright.config.ts. Several claims here are geometry, and
 * geometry only exists at one width, so those tests say which one they are for
 * and skip on the other rather than asserting something meaningless twice.
 *
 * `?seed=binders` gives `fx-full` (9-pocket, three pages, every pocket filled,
 * with a chosen cover), `fx-sparse` (12-pocket, one card on page 3) and
 * `fx-empty` (9-pocket, nothing in it). `?seed=trade` gives `fx-trade`
 * (4-pocket, forTrade, showValue, first pocket stacked three deep).
 */

const WIDE = 1000;

/** The rendered width of one pocket, which is the claim made in pixels. */
async function pocketWidth(page: Page, at = "0:0"): Promise<number> {
  const box = await page.locator(`[data-pocket="${at}"]`).first().boundingBox();
  if (!box) throw new Error(`no pocket at ${at}`);
  return box.width;
}

function isWide(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) >= WIDE;
}

test.describe("a binder that is not there", () => {
  test("says so, and offers the way back", async ({ page }) => {
    // An absent binder is indistinguishable from one this device has never
    // seen, which is exactly why a deletion is recorded rather than merely
    // absent. The screen should not look broken while saying so.
    await openV2(page, "/binder/nope", { seed: "binders" });
    await expect(page.getByRole("heading", { name: "That binder is not here" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to your binders" })).toBeVisible();
  });
});

test.describe("the shelf leads here", () => {
  test("opening a binder from the shelf lands on its pages", async ({ page }) => {
    await openV2(page, "/binders", { seed: "binders" });
    await page.getByRole("link", { name: /Jolteon/ }).click();
    await expect(page.getByRole("heading", { name: "Jolteon", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Page 1", level: 2 })).toBeVisible();
    // Three 9-pocket pages, all filled. The COVER is not in that figure.
    await expect(page.getByRole("main")).toContainText("27 / 27 pockets filled");
  });
});

test.describe("a pocket is a pocket", () => {
  /*
   * The claim the whole stylesheet is built around: the same physical size in 9
   * and 12, bigger in 4-pocket — which exists for jumbo cards. It is the PAGE
   * that gets wider with more columns. v1 drew a 12-pocket page's pockets at
   * 92px beside a 9-pocket page's 125px, and the two binders read as different
   * products rather than as the same cards filed differently.
   */
  test("is the same width in 9 and 12, to within a pixel", async ({ page }) => {
    test.skip(!isWide(page), "geometry claim; below 1000px a page fits the viewport instead");
    await openV2(page, "/binder/fx-full", { seed: "binders" });
    const nine = await pocketWidth(page);
    await openV2(page, "/binder/fx-sparse", { seed: "binders" });
    const twelve = await pocketWidth(page);
    expect(Math.abs(nine - twelve)).toBeLessThanOrEqual(1);
  });

  test("is at least 1.3x in a 4-pocket binder, which is for jumbo cards", async ({ page }) => {
    test.skip(!isWide(page), "geometry claim; below 1000px a page fits the viewport instead");
    await openV2(page, "/binder/fx-full", { seed: "binders" });
    const nine = await pocketWidth(page);
    await openV2(page, "/binder/fx-trade", { seed: "trade" });
    const four = await pocketWidth(page);
    expect(four / nine).toBeGreaterThanOrEqual(1.3);
  });

  test("makes the PAGE wider with more columns, not the pockets narrower", async ({ page }) => {
    test.skip(!isWide(page), "geometry claim; below 1000px a page fits the viewport instead");
    await openV2(page, "/binder/fx-full", { seed: "binders" });
    const nine = await page.getByRole("region", { name: "Page 1" }).boundingBox();
    await openV2(page, "/binder/fx-sparse", { seed: "binders" });
    const twelve = await page.getByRole("region", { name: "Page 1" }).boundingBox();
    expect(twelve!.width).toBeGreaterThan(nine!.width);
  });
});

test.describe("how the binder falls open", () => {
  test("page 1 is alone against the cover, then pages face each other", async ({ page }) => {
    test.skip(!isWide(page), "facing pages only exist above 1000px");
    await openV2(page, "/binder/fx-full", { seed: "binders" });
    const one = await page.getByRole("region", { name: "Page 1" }).boundingBox();
    const two = await page.getByRole("region", { name: "Page 2" }).boundingBox();
    const three = await page.getByRole("region", { name: "Page 3" }).boundingBox();
    // 2 and 3 share a row; 1 does not share it with either.
    expect(Math.abs(two!.y - three!.y)).toBeLessThanOrEqual(2);
    expect(two!.x).toBeLessThan(three!.x);
    expect(one!.y).toBeLessThan(two!.y);
    // ...and page 1 sits to the RIGHT, because that is where a binder opens.
    expect(one!.x).toBeGreaterThan(two!.x);
  });

  test("a 4-pocket binder has no facing pages at all", async ({ page }) => {
    test.skip(!isWide(page), "facing pages only exist above 1000px");
    // Two 2-column pages abreast are indistinguishable from one 12-pocket page,
    // and the format holds the big cards — halving its width throws away the
    // one thing it is for.
    await openV2(page, "/binder/fx-trade", { seed: "trade" });
    await page.getByRole("button", { name: "Add page" }).click();
    const one = await page.getByRole("region", { name: "Page 1" }).boundingBox();
    const two = await page.getByRole("region", { name: "Page 2" }).boundingBox();
    expect(two!.y).toBeGreaterThan(one!.y + one!.height - 2);
  });
});

test.describe("the cover", () => {
  test("is a real slot, and is not counted among the pockets", async ({ page }) => {
    await openV2(page, "/binder/fx-full", { seed: "binders" });
    // fx-full has a chosen cover AND 27 of 27 pockets filled. If the cover were
    // a pocket this would read 28 of 28.
    await expect(page.getByRole("button", { name: /^Cover,/ })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("27 / 27 pockets filled");
  });

  test("survives a reload", async ({ page }) => {
    await openV2(page, "/binder/fx-empty", { seed: "binders" });
    await page.getByRole("button", { name: "Cover, empty" }).click();
    await page
      .getByRole("button", { name: /Charizard ex.*not owned/ })
      .first()
      .click();
    await expect(page.getByRole("button", { name: /^Cover, Charizard ex/ })).toBeVisible();

    // Reopen WITHOUT re-seeding, so what comes back is what was stored.
    await page.goto("/?v=2#/binder/fx-empty");
    await expect(page.getByRole("button", { name: /^Cover, Charizard ex/ })).toBeVisible();
    // Still not a pocket: the binder is 9-pocket and empty.
    await expect(page.getByRole("main")).toContainText("0 / 9 pockets filled");
  });

  test("is untouched when the binder is reformatted", async ({ page }) => {
    await openV2(page, "/binder/fx-full", { seed: "binders" });
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("group", { name: "Pocket size" }).getByRole("button", { name: "12-pocket" }).click();
    // Reformatting re-flows the CONTENTS in reading order. A cover is not
    // contents, so it is still there and still not counted.
    await expect(page.getByRole("button", { name: /^Cover, Jolteon/ })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("27 / 36 pockets filled");
  });
});

test.describe("choosing a pocket and filling it", () => {
  test("advances to the next empty pocket, so a binder fills card after card", async ({ page }) => {
    await openV2(page, "/binder/fx-empty", { seed: "binders" });
    await page.getByRole("button", { name: "Page 1, pocket 1, empty" }).click();
    await expect(page.getByRole("main")).toContainText("pocket 1 chosen");

    await page
      .getByRole("button", { name: /Charizard ex.*not owned/ })
      .first()
      .click();
    // The selection MOVED. Left where it was, the next card would replace this
    // one and the binder would never grow past a single card.
    await expect(page.getByRole("main")).toContainText("pocket 2 chosen");
    await expect(page.getByRole("main")).toContainText("1 / 9 pockets filled");
  });

  test("clearing a pocket stays on it", async ({ page }) => {
    await openV2(page, "/binder/fx-full", { seed: "binders" });
    await page.getByRole("button", { name: /^Page 1, pocket 1, Jolteon/ }).click();
    await page.getByRole("button", { name: /^Clear pocket 1$/ }).click();
    await expect(page.getByRole("main")).toContainText("pocket 1 chosen");
    await expect(page.getByRole("button", { name: "Page 1, pocket 1, empty" })).toBeVisible();
  });

  test("an unowned card is tagged in words, not only shaded", async ({ page }) => {
    // Shading is a colour, and colour is never the only carrier of meaning.
    await openV2(page, "/binder/fx-full", { seed: "binders" });
    await expect(page.getByRole("button", { name: /Page 3, pocket 9,.*not owned/ })).toBeVisible();
  });
});

test.describe("adding and removing pages", () => {
  test("a page added survives a reload", async ({ page }) => {
    await openV2(page, "/binder/fx-empty", { seed: "binders" });
    await page.getByRole("button", { name: "Add page" }).click();
    await expect(page.getByRole("main")).toContainText("0 / 18 pockets filled");
    await page.goto("/?v=2#/binder/fx-empty");
    await expect(page.getByRole("main")).toContainText("0 / 18 pockets filled");
  });

  test("nothing trims a trailing empty page on its own", async ({ page }) => {
    // The automatic trim is what made "Add page" a silent no-op for as long as
    // binders existed: it grew the binder and the same commit dropped the new
    // page again.
    await openV2(page, "/binder/fx-empty", { seed: "binders" });
    await page.getByRole("button", { name: "Add page" }).click();
    await page.getByRole("button", { name: "Add page" }).click();
    await expect(page.getByRole("heading", { name: "Page 3", level: 2 })).toBeVisible();
  });

  test("remove page is refused for the only page, and says why", async ({ page }) => {
    await openV2(page, "/binder/fx-empty", { seed: "binders" });
    await expect(
      page.getByRole("button", { name: /Remove page — a binder keeps its first page/ }),
    ).toBeDisabled();
  });

  test("remove page is refused while the last page holds cards", async ({ page }) => {
    await openV2(page, "/binder/fx-full", { seed: "binders" });
    await expect(
      page.getByRole("button", { name: /Remove page — the last page still has cards/ }),
    ).toBeDisabled();
  });

  test("removes an empty trailing page when asked", async ({ page }) => {
    await openV2(page, "/binder/fx-empty", { seed: "binders" });
    await page.getByRole("button", { name: "Add page" }).click();
    await page.getByRole("button", { name: "Remove page" }).click();
    await expect(page.getByRole("main")).toContainText("0 / 9 pockets filled");
  });
});

test.describe("dragging", () => {
  /**
   * A mouse drag past 5px. The touch gesture is a HOLD and cannot be exercised
   * here — Chrome's touch emulation answers a drag by panning and sends
   * pointercancel on the first move — so it lives in
   * `src/features/binders/useBinderDrag.test.ts` with fake timers instead.
   */
  async function dragPocket(page: Page, from: string, to: string) {
    // Both ends have to be on screen at once: `page.mouse` works in viewport
    // coordinates, and a box below the fold is a point the pointer never
    // reaches. On a phone that is a real constraint, not a test artefact.
    await page.locator(`[data-pocket="${to}"]`).scrollIntoViewIfNeeded();
    const a = await page.locator(`[data-pocket="${from}"]`).boundingBox();
    const b = await page.locator(`[data-pocket="${to}"]`).boundingBox();
    await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2);
    await page.mouse.down();
    await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, { steps: 8 });
    await page.mouse.up();
  }

  /**
   * Which card is in a pocket, by its art.
   *
   * Not the accessible label: that leads with the pocket's own address, so two
   * pockets never share one — and every card in `fx-full` carries the same
   * denormalised name. The art URL is the only thing on screen that identifies
   * the printing, which is also true for the person looking at it.
   */
  function artIn(page: Page, at: string) {
    return page.locator(`[data-pocket="${at}"] img`).getAttribute("src");
  }

  test("swaps two occupied pockets", async ({ page }) => {
    await openV2(page, "/binder/fx-full", { seed: "binders" });
    const first = await artIn(page, "0:0");
    const second = await artIn(page, "0:1");
    expect(first).not.toBe(second);

    await dragPocket(page, "0:0", "0:1");
    // Swapped, not overwritten: the card leaving the source has to go somewhere,
    // and destroying it would have no undo.
    expect(await artIn(page, "0:1")).toBe(first);
    expect(await artIn(page, "0:0")).toBe(second);
  });

  test("does not destroy a card dropped back where it started", async ({ page }) => {
    await openV2(page, "/binder/fx-full", { seed: "binders" });
    const before = await artIn(page, "0:0");
    await dragPocket(page, "0:0", "0:0");
    expect(await artIn(page, "0:0")).toBe(before);
    await expect(page.getByRole("main")).toContainText("27 / 27 pockets filled");
  });

  test("a drop does not also open the picker on the pocket it landed on", async ({ page }) => {
    /*
     * The pointerup leaves a click behind on whatever it was dropped on.
     * Rearranging a binder is not filling one, and opening the picker once per
     * card while a page is tidied answers a question nobody asked.
     */
    await openV2(page, "/binder/fx-full", { seed: "binders" });
    await expect(page.getByRole("button", { name: "Cards", exact: true })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await dragPocket(page, "0:0", "0:1");
    await expect(page.getByRole("button", { name: "Cards", exact: true })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(page.getByRole("main")).toContainText("Choose a pocket");
  });

  test("carries a card onto the cover, and off it again", async ({ page }) => {
    await openV2(page, "/binder/fx-empty", { seed: "binders" });
    await page.getByRole("button", { name: "Page 1, pocket 1, empty" }).click();
    await page
      .getByRole("button", { name: /Charizard ex.*not owned/ })
      .first()
      .click();
    const placed = await page.locator('[data-pocket="0:0"]').getAttribute("aria-label");
    expect(placed).toContain("Charizard ex");

    // On a phone the picker is a modal sheet, so its scrim is what a drag would
    // land on. Shut it first — which is what a person does before rearranging.
    await page.keyboard.press("Escape");
    await dragPocket(page, "0:0", "cover");
    await expect(page.getByRole("button", { name: /^Cover, Charizard ex/ })).toBeVisible();
    // The pocket it came from is empty, and the cover is still not counted.
    await expect(page.getByRole("main")).toContainText("0 / 9 pockets filled");
  });
});

test.describe("the picker", () => {
  test("comes out when a pocket is chosen, and shuts again", async ({ page }) => {
    await openV2(page, "/binder/fx-empty", { seed: "binders" });
    const toggle = page.getByRole("button", { name: "Cards", exact: true });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("button", { name: "Page 1, pocket 1, empty" }).click();
    await expect(page.getByRole("searchbox", { name: "Search every set" })).toBeVisible();
  });

  test("shut, it costs the spread no width at all", async ({ page }) => {
    /*
     * The whole reason `RailHost` exists. While a shut rail still held grid
     * track, the binder beside it lost 33px of pocket and a 12-pocket page
     * rendered at 92px against a 9-pocket page's 125px — so a panel that is not
     * open has to cost nothing.
     */
    test.skip(!isWide(page), "the rail only exists above 1000px");
    await openV2(page, "/binder/fx-sparse", { seed: "binders" });
    const shut = await pocketWidth(page);

    await page.getByRole("button", { name: "Cards", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "Cards" })).toBeVisible();
    const open = await pocketWidth(page);
    // Opening it IS allowed to cost width — that is a choice the user made.
    expect(open).toBeLessThan(shut);

    await page.getByRole("button", { name: "Hide cards" }).click();
    await expect(page.getByRole("complementary", { name: "Cards" })).toBeHidden();
    expect(await pocketWidth(page)).toBeCloseTo(shut, 0);
  });

  test("finds a card in a set the browse list is not showing", async ({ page }) => {
    await openV2(page, "/binder/fx-empty", { seed: "binders" });
    await page.getByRole("button", { name: "Page 1, pocket 1, empty" }).click();
    await page.getByRole("searchbox", { name: "Search every set" }).fill("Umbreon");
    await page.getByRole("button", { name: "Search" }).click();
    await page
      .getByRole("button", { name: /Umbreon VMAX/ })
      .first()
      .click();
    // Two taps, because a search result carries no trustworthy printing list:
    // pick the card, then pick the printing.
    // Not scoped to `main`: at 390 the picker is a modal sheet OUTSIDE it.
    await expect(page.getByText(/Which printing goes in/)).toBeVisible();
    await page.getByRole("button", { name: "Holofoil", exact: true }).first().click();
    await expect(page.getByRole("button", { name: /Page 1, pocket 1, Umbreon VMAX/ })).toBeVisible();
  });

  test("fills the binder with one of each card in a set", async ({ page }) => {
    await openV2(page, "/binder/fx-empty", { seed: "binders" });
    await page.getByRole("button", { name: "Cards", exact: true }).click();
    await page.getByRole("button", { name: "Fill with one of each" }).click();
    await expect(page.getByRole("main")).not.toContainText("0 / 9 pockets filled");
  });
});

test.describe("a trade binder", () => {
  test("offers copies and condition, and an ordinary binder does not", async ({ page }) => {
    await openV2(page, "/binder/fx-trade", { seed: "trade" });
    await page.getByRole("button", { name: /^Page 1, pocket 1,/ }).click();
    await expect(page.getByRole("group", { name: "Copies" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Condition" })).toBeVisible();
  });

  test("reads the stock aloud as words, not as ×3 LP", async ({ page }) => {
    await openV2(page, "/binder/fx-trade", { seed: "trade" });
    await expect(page.getByRole("button", { name: /3 copies, Lightly played/ })).toBeVisible();
  });

  test("will not count below one copy", async ({ page }) => {
    await openV2(page, "/binder/fx-trade", { seed: "trade" });
    await page.getByRole("button", { name: /^Page 1, pocket 2,/ }).click();
    await expect(page.getByRole("button", { name: "One fewer copy" })).toBeDisabled();
  });

  test("counts copies without moving off the pocket being counted", async ({ page }) => {
    await openV2(page, "/binder/fx-trade", { seed: "trade" });
    await page.getByRole("button", { name: /^Page 1, pocket 2,/ }).click();
    await page.getByRole("button", { name: "One more copy" }).click();
    await expect(page.getByRole("main")).toContainText("pocket 2 chosen");
    await expect(page.getByRole("button", { name: /Page 1, pocket 2,.*2 copies/ })).toBeVisible();
  });

  test("counts the copies in the footnote, not just the pockets", async ({ page }) => {
    // fx-trade: four pockets, the first stacked three deep.
    await openV2(page, "/binder/fx-trade", { seed: "trade" });
    await expect(page.getByRole("main")).toContainText("6 cards in 4 pockets across 1 page · 4-pocket");
  });
});

test.describe("prices", () => {
  test("says n/a on a pocket nothing prices, never a blank", async ({ page }) => {
    // A blank where a price belongs reads as "still loading" forever. Under
    // mocks nothing in these binders resolves a printing price.
    await openV2(page, "/binder/fx-full", { seed: "binders" });
    await expect(page.locator('[data-pocket="0:0"]')).toContainText("n/a");
    await expect(page.getByRole("button", { name: /Page 1, pocket 1,.*price unavailable/ })).toBeVisible();
  });

  test("never shows $0.00 for a binder it could not price", async ({ page }) => {
    await openV2(page, "/binder/fx-full", { seed: "binders" });
    await expect(page.getByRole("main")).not.toContainText("$0.00");
  });
});

test.describe("the request budget", () => {
  /**
   * A binder spans sets the way a set screen never does — the Riolu binder
   * touches thirty — so pricing asks the printings oracle once per SET rather
   * than once per card. That is the difference between thirty requests and
   * three hundred.
   */
  test("asks once per set, not once per card", async ({ page }) => {
    const urls: string[] = [];
    page.on("request", (r) => urls.push(r.url()));
    await openV2(page, "/binder/fx-full", { seed: "binders" });
    await expect(page.getByRole("heading", { name: "Page 1", level: 2 })).toBeVisible();
    await page.waitForLoadState("networkidle");

    // fx-full holds 27 cards drawn from nine distinct sets, plus the cover.
    const printings = urls.filter((u) => u.includes("/api/printings/"));
    expect(printings.length).toBeLessThanOrEqual(new Set(printings).size);
    expect(printings.length).toBeLessThanOrEqual(10);
  });
});

test.describe("binder @visual", () => {
  test("looks like itself", async ({ page }) => {
    await openV2(page, "/binder/fx-full", { seed: "binders" });
    await expect(page.getByRole("heading", { name: "Jolteon", level: 1 })).toBeVisible();
    await stabiliseForSnapshot(page);
    await expect(page).toHaveScreenshot("binder.png", { fullPage: true });
  });
});
