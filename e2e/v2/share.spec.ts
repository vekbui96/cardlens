import { expect, test, type Page } from "@playwright/test";
import { openV2, stabiliseForSnapshot } from "./pages/base.ts";

/**
 * The three public pages, driven the way a stranger meets them: a link, and
 * nothing else. No token, no account, no collection, no storage.
 */

const TRADE = {
  kind: "binder",
  at: 1_800_000_000_000,
  binder: {
    id: "fx-trade",
    name: "Jolteon spares",
    format: "9",
    forTrade: true,
    createdAt: 1,
    updatedAt: 2,
    pages: [
      {
        slots: {
          "0": {
            kind: "card",
            cardId: "base2-4",
            finish: "holo",
            name: "Jolteon",
            collectorNumber: "4",
            quantity: 2,
            condition: "LP",
          },
          "4": { kind: "card", cardId: "ex2-6", finish: "holo", name: "Espeon", collectorNumber: "6" },
        },
      },
    ],
  },
};

const SET_SHARE_UNTAGGED = {
  // No `kind` — exactly the shape of the legacy rows in the live shares.json.
  setId: "base2",
  setName: "Base Set 2",
  at: 1_800_000_000_000,
  owned: [{ collectorNumber: "4", finish: "holo" }],
};

async function serveShare(page: Page, body: unknown, status = 200) {
  await page.route("**/api/share/**", (route) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }),
  );
}

test.describe("a trade link", () => {
  test("renders for someone with completely empty storage", async ({ page }) => {
    // The whole premise: the recipient has never used this app.
    await serveShare(page, TRADE);
    await openV2(page, "/trade/abc123");

    await expect(page.getByRole("heading", { name: "Jolteon spares", level: 1 })).toBeVisible();
    const stored = await page.evaluate(() => JSON.stringify(localStorage));
    expect(stored).not.toContain("collection");
  });

  test("names each card by its pocket, which is how you ask for it", async ({ page }) => {
    await serveShare(page, TRADE);
    await openV2(page, "/trade/abc123");
    // Page 1, pocket 1 and pocket 5.
    await expect(page.getByText("1·1", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("1·5", { exact: false }).first()).toBeVisible();
  });

  test("shows copies and condition without letting condition move a price", async ({ page }) => {
    await serveShare(page, TRADE);
    await openV2(page, "/trade/abc123");
    await expect(page.getByText(/2 copies/)).toBeVisible();
    await expect(page.getByText(/Lightly played|LP/i).first()).toBeVisible();
  });

  test("never says the owner does not own what they are offering", async ({ page }) => {
    // `BinderSpread`'s "Don't own" tag is for the BUILDER, where an unowned
    // card is one you are planning to get. On a trade page every card is in the
    // owner's hand — tagging them all was the page telling a visitor that the
    // person offering these cards does not have them.
    await serveShare(page, TRADE);
    await openV2(page, "/trade/abc123");
    await expect(page.getByText("Don't own")).toHaveCount(0);
  });

  test("no pocket is a button — the page is read-only", async ({ page }) => {
    await serveShare(page, TRADE);
    await openV2(page, "/trade/abc123");
    const pockets = page.locator("[data-pocket]");
    await expect(pockets.first()).toBeVisible();
    // Whatever a pocket is here, it is not something you can press.
    expect(await pockets.locator("button").count()).toBe(0);
  });
});

test.describe("a set link", () => {
  test("an untagged legacy row still renders as a set share", async ({ page }) => {
    // There is a live shares.json full of these. Breaking them breaks links
    // that are already in other people's hands.
    await serveShare(page, SET_SHARE_UNTAGGED);
    await openV2(page, "/live/legacy1");
    await expect(page.getByRole("heading", { name: "Base Set 2", level: 1 })).toBeVisible();
  });
});

test.describe("a link that does not answer", () => {
  test("a revoked link and one that never existed are indistinguishable", async ({ page }) => {
    await serveShare(page, { error: "not_found" }, 404);
    await openV2(page, "/live/revoked");
    const revoked = await page.getByRole("main").textContent();

    await page.unrouteAll();
    await serveShare(page, { error: "not_found" }, 404);
    await openV2(page, "/live/never-existed-at-all");
    const missing = await page.getByRole("main").textContent();

    // Byte-identical, on purpose: anything else says which ids were once real.
    expect(revoked).toBe(missing);
    expect(revoked).toContain("This link doesn't work");
  });

  test("a binder id on the set route does not render an empty set", async ({ page }) => {
    // It is a real share, but not this page's kind. Quietly drawing nothing
    // would read as a broken link rather than as the wrong door.
    await serveShare(page, TRADE);
    await openV2(page, "/live/abc123");
    await expect(page.getByText("This link doesn't work")).toBeVisible();
  });
});

test.describe("share @visual", () => {
  test("a trade page looks like itself", async ({ page }) => {
    await serveShare(page, TRADE);
    await openV2(page, "/trade/abc123");
    await expect(page.getByRole("heading", { name: "Jolteon spares", level: 1 })).toBeVisible();
    await stabiliseForSnapshot(page);
    await expect(page.getByRole("main")).toHaveScreenshot("trade.png", { timeout: 20000 });
  });
});
