import { test, expect, type APIRequestContext } from "@playwright/test";

/** Matches the token the e2e API server is started with — see playwright.config.ts. */
const E2E_TOKEN = "e2e-token";
const API = "http://localhost:8787/api";

/**
 * A binder offered for trade, end to end against the real server.
 *
 * This is the one spec that exercises the trade path all the way through:
 * pushing a binder through sync, minting a link for it, and opening that link
 * with NO token at all — which is the whole point, since the recipient is by
 * definition somebody with no account here.
 *
 * Web-only, and at phone size. A trade link is something you are sent and open
 * on a phone; the glasses have no way to open a link at all.
 */

const card = (n: string, name: string, over: Record<string, unknown> = {}) => ({
  kind: "card",
  cardId: `sv3-${n}`,
  finish: "normal",
  collectorNumber: n,
  name,
  ...over,
});

/** Push a trade binder to the server and mint its link. Returns the share id. */
async function shareTradeBinder(request: APIRequestContext, id: string) {
  const now = Date.now();
  const binder = {
    id,
    name: "Spares and dupes",
    format: "9",
    forTrade: true,
    createdAt: now,
    updatedAt: now,
    pages: [
      {
        slots: {
          0: card("1", "Charmander", { quantity: 3, condition: "LP" }),
          4: card("2", "Charmeleon"),
        },
      },
      { slots: { 2: card("3", "Charizard ex") } },
    ],
  };

  const push = await request.post(`${API}/binders/merge`, {
    headers: { authorization: `Bearer ${E2E_TOKEN}` },
    data: { binders: [binder] },
  });
  expect(push.ok()).toBeTruthy();
  // A dropped binder means the whitelist rejected a trade field, which is the
  // silent failure this codebase keeps being bitten by — so it is asserted
  // rather than assumed.
  expect((await push.json()).dropped).toBe(0);

  const share = await request.post(`${API}/share/binder`, {
    headers: { authorization: `Bearer ${E2E_TOKEN}` },
    data: { binderId: id },
  });
  expect(share.ok()).toBeTruthy();
  return (await share.json()).id as string;
}

test.describe("trade binder", () => {
  // Playwright requires an object-destructuring first argument here.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "phone project only");
  });

  test("opens a trade link with no token and shows what is on offer", async ({ page, request }) => {
    const shareId = await shareTradeBinder(request, `trade-open-${Date.now()}`);

    await page.goto(`/?ui=web#/trade/${shareId}`);

    await expect(page.getByRole("heading", { name: "Spares and dupes" })).toBeVisible();
    // Five cards in three pockets: the stack of three is one pocket. Getting
    // this backwards is the whole reason copies and pockets are counted apart.
    await expect(page.getByText(/5 cards in 3 pockets/)).toBeVisible();

    // The pocket address, which is how the two collectors will name the card.
    await expect(page.getByText("1·1", { exact: true })).toBeVisible();
    await expect(page.getByText("2·3", { exact: true })).toBeVisible();
    await expect(page.getByText("×3 LP", { exact: true })).toBeVisible();
  });

  test("a list row jumps to the pocket it names", async ({ page, request }) => {
    const shareId = await shareTradeBinder(request, `trade-jump-${Date.now()}`);
    await page.goto(`/?ui=web#/trade/${shareId}`);
    await expect(page.getByRole("heading", { name: "Spares and dupes" })).toBeVisible();

    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect(page.getByTestId("trade-list")).toBeVisible();
    await expect(page.getByText("Charizard ex")).toBeVisible();

    await page.getByRole("button", { name: /Charizard ex, page 2 pocket 3/ }).click();

    // Back on the binder, with that pocket selected — the binding between the
    // two views.
    await expect(page.getByTestId("trade-binder")).toBeVisible();
    await expect(page.getByRole("img", { name: /Page 2, Pocket 3, Charizard ex/ })).toBeVisible();
  });

  test("a revoked link stops answering", async ({ page, request }) => {
    const shareId = await shareTradeBinder(request, `trade-revoke-${Date.now()}`);
    await page.goto(`/?ui=web#/trade/${shareId}`);
    await expect(page.getByRole("heading", { name: "Spares and dupes" })).toBeVisible();

    const revoked = await request.delete(`${API}/share/${shareId}`, {
      headers: { authorization: `Bearer ${E2E_TOKEN}` },
    });
    expect(revoked.ok()).toBeTruthy();

    await page.reload();
    await expect(page.getByText("This trade link is no longer shared")).toBeVisible();
  });

  test("refuses to mint a link for a binder the server has never seen", async ({ request }) => {
    // A link that 404s for whoever it was sent to is worse than no link, so the
    // server says so instead of minting one.
    const res = await request.post(`${API}/share/binder`, {
      headers: { authorization: `Bearer ${E2E_TOKEN}` },
      data: { binderId: "a-binder-that-was-never-synced" },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toBe("binder_not_synced");
  });

  test("does not lay the page out sideways on a phone", async ({ page, request }) => {
    const shareId = await shareTradeBinder(request, `trade-layout-${Date.now()}`);
    await page.goto(`/?ui=web#/trade/${shareId}`);
    await expect(page.getByRole("heading", { name: "Spares and dupes" })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
