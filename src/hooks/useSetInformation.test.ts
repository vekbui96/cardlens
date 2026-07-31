import { afterEach, describe, expect, it, vi } from "vitest";
import { MOCK_CARDS } from "../integrations/pokemon/fixtures.ts";
import { ProviderError } from "../integrations/providers.ts";
import { fetchSetInformation, toSetPrintings } from "./useSetInformation.ts";

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

describe("toSetPrintings", () => {
  it("returns null for anything that is not an object", () => {
    expect(toSetPrintings(null)).toBeNull();
    expect(toSetPrintings(undefined)).toBeNull();
    expect(toSetPrintings("printings")).toBeNull();
  });
});
