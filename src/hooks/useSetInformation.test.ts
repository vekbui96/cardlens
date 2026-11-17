import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_CARDS } from "../integrations/pokemon/fixtures.ts";
import { ProviderError } from "../integrations/providers.ts";
import { printingsCache, setCardsCache } from "../storage/caches.ts";
import { fetchSetInformation, rememberSetInformation, toSetPrintings } from "./useSetInformation.ts";

/**
 * The hook itself switches off under mocks — deliberately, so tests and the e2e
 * run never reach for a home server that is not there. The fetch and the parsing
 * are the parts worth exercising, so they are driven directly.
 */
function respondWith(body: unknown, init: { status?: number } = {}) {
  const fetchMock = vi.fn((_url: RequestInfo | URL) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchSetInformation", () => {
  it("asks once, for the set and its name", async () => {
    const fetchMock = respondWith({ setId: "sv3", cards: { data: MOCK_CARDS }, printings: null });

    await fetchSetInformation("sv3", "Obsidian Flames");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/set-information/sv3");
    // The server needs the name: TCGdex set ids differ from pokemontcg.io's
    // (me5 vs me05), so printings are matched by normalised name.
    expect(url).toContain(`name=${encodeURIComponent("Obsidian Flames")}`);
  });

  it("maps the raw cards into summaries, most valuable first", async () => {
    respondWith({ cards: { data: MOCK_CARDS } });

    const info = await fetchSetInformation("sv3", "Obsidian Flames");

    expect(info.cards).toHaveLength(MOCK_CARDS.length);
    const prices = info.cards.map((c) => c.marketPrice ?? 0);
    expect([...prices].sort((a, b) => b - a)).toEqual(prices);
  });

  it("accepts printings as the whole SetPrintings record", async () => {
    respondWith({
      cards: { data: MOCK_CARDS },
      printings: { tcgdexSetId: "sv03", byNumber: { "1": [{ type: "normal" }] } },
    });

    const info = await fetchSetInformation("sv3", "Obsidian Flames");

    expect(info.printings).toEqual({ tcgdexSetId: "sv03", byNumber: { "1": [{ type: "normal" }] } });
  });

  it("accepts printings as a bare byNumber map", async () => {
    // The shape the endpoint shipped with first. Tolerating both is what lets
    // the client and the server deploy in either order.
    respondWith({ cards: { data: MOCK_CARDS }, printings: { "1": [{ type: "normal" }] } });

    const info = await fetchSetInformation("sv3", "Obsidian Flames");

    expect(info.printings?.byNumber).toEqual({ "1": [{ type: "normal" }] });
    // No source recorded, which is what keeps this out of the 30-day cache.
    expect(info.printings?.tcgdexSetId).toBe("");
  });

  it("reports no printings rather than failing when the server had none", async () => {
    respondWith({ cards: { data: MOCK_CARDS }, printings: null });

    const info = await fetchSetInformation("sv3", "Obsidian Flames");

    expect(info.printings).toBeNull();
    expect(info.cards.length).toBeGreaterThan(0);
  });

  it("rejects a malformed card payload so the caller falls back", async () => {
    respondWith({ cards: { data: [{ nonsense: true }] } });

    await expect(fetchSetInformation("sv3", "Obsidian Flames")).rejects.toBeInstanceOf(ProviderError);
  });

  it("rejects when the server is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );

    await expect(fetchSetInformation("sv3", "Obsidian Flames")).rejects.toBeInstanceOf(ProviderError);
  });
});

/**
 * A set built while TCGdex was skipping cards must not stick on the device.
 *
 * `/api/printings` says so through `Cache-Control`; this combined endpoint
 * caches for an hour either way, so it says so with `printingsComplete`. The
 * printings it hands over seed `printingsCache`, which Home and binders read
 * for 30 days — the gap #28 closed for the other path. Live, Fates Collide sat
 * at 119 of 125 numbers.
 */
describe("set-information and incomplete printings", () => {
  const PRINTINGS = { tcgdexSetId: "xy10", byNumber: { "1": [{ type: "normal" }] } };

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("marks the printings provisional when the server says they are incomplete", async () => {
    respondWith({ cards: { data: MOCK_CARDS }, printings: PRINTINGS, printingsComplete: false });

    const info = await fetchSetInformation("xy10", "Fates Collide");

    expect(info.printings?.provisional).toBe(true);
    expect(info.printings?.byNumber).toEqual(PRINTINGS.byNumber);
  });

  it("leaves complete printings, and an older server's, unmarked", async () => {
    respondWith({ cards: { data: MOCK_CARDS }, printings: PRINTINGS, printingsComplete: true });
    expect((await fetchSetInformation("xy10", "Fates Collide")).printings).toEqual(PRINTINGS);

    // No field at all: a server from before it existed, whose answers were
    // always taken as complete.
    respondWith({ cards: { data: MOCK_CARDS }, printings: PRINTINGS });
    expect((await fetchSetInformation("xy10", "Fates Collide")).printings).toEqual(PRINTINGS);
  });

  it("does not store provisional printings, but still stores the cards", async () => {
    respondWith({ cards: { data: MOCK_CARDS }, printings: PRINTINGS, printingsComplete: false });
    const info = await fetchSetInformation("xy10", "Fates Collide");

    rememberSetInformation("xy10", info);

    expect(printingsCache.get("xy10")).toBeNull();
    expect(setCardsCache.get("xy10|")?.value).toHaveLength(MOCK_CARDS.length);
  });

  it("stores complete printings for the long haul", async () => {
    respondWith({ cards: { data: MOCK_CARDS }, printings: PRINTINGS, printingsComplete: true });
    const info = await fetchSetInformation("xy10", "Fates Collide");

    rememberSetInformation("xy10", info);

    expect(printingsCache.get("xy10")?.value).toEqual(PRINTINGS);
  });
});

describe("toSetPrintings", () => {
  it("returns null for anything that is not an object", () => {
    expect(toSetPrintings(null)).toBeNull();
    expect(toSetPrintings(undefined)).toBeNull();
    expect(toSetPrintings("printings")).toBeNull();
  });
});
