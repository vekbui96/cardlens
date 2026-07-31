import { afterEach, describe, expect, it, vi } from "vitest";
import { TcgdexClient } from "./client.ts";
import { ProviderError } from "../providers.ts";

const SETS = [
  { id: "me05", name: "Pitch Black", cardCount: { total: 120, official: 84 } },
  { id: "sv10.5w", name: "White Flare" },
  { id: "base1", name: "Base" },
];

/**
 * Mirrors the live API's actual shape: the set endpoint returns card BRIEFS
 * with no variants (verified: only id, image, localId, name), and variants come
 * only from the per-card endpoint.
 */
const PITCH_BLACK = {
  id: "me05",
  name: "Pitch Black",
  cards: [
    { id: "me05-001", localId: "001", name: "Tropius" },
    { id: "me05-014", localId: "014", name: "Rowlet" },
    { id: "me05-nope", localId: "", name: "Broken" },
  ],
};

const CARDS: Record<string, unknown> = {
  "/cards/me05-001": {
    id: "me05-001",
    localId: "001",
    variants_detailed: [{ type: "normal" }, { type: "reverse" }],
  },
  "/cards/me05-014": {
    id: "me05-014",
    localId: "014",
    variants_detailed: [
      { type: "holo" },
      { type: "reverse", foil: "pokeball" },
      { type: "reverse", foil: "masterball" },
    ],
  },
  "/cards/me05-nope": { id: "me05-nope", localId: "", variants_detailed: [{ type: "normal" }] },
};

function mockFetch(routes: Record<string, unknown>) {
  return vi.fn((url: string) => {
    const body = Object.entries(routes).find(([k]) => url.includes(k))?.[1];
    if (body === undefined) {
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) } as Response);
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TcgdexClient.resolveSetId", () => {
  it("matches by normalised name, not by id", async () => {
    // The ids genuinely differ: pokemontcg.io says "me5", TCGdex says "me05".
    vi.stubGlobal("fetch", mockFetch({ "/sets": SETS }));
    const client = new TcgdexClient();
    await expect(client.resolveSetId("me5", "Pitch Black")).resolves.toBe("me05");
  });

  it("ignores punctuation and case differences", async () => {
    vi.stubGlobal("fetch", mockFetch({ "/sets": SETS }));
    const client = new TcgdexClient();
    await expect(client.resolveSetId("sv10pt5w", "white-flare!")).resolves.toBe("sv10.5w");
  });

  it("returns null for a set it cannot place", async () => {
    vi.stubGlobal("fetch", mockFetch({ "/sets": SETS }));
    const client = new TcgdexClient();
    await expect(client.resolveSetId("zzz9", "Nonexistent Set")).resolves.toBeNull();
  });

  it("fetches the set list only once across calls", async () => {
    const fetchMock = mockFetch({ "/sets": SETS });
    vi.stubGlobal("fetch", fetchMock);
    const client = new TcgdexClient();
    await client.resolveSetId("me5", "Pitch Black");
    await client.resolveSetId("sv10pt5w", "White Flare");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed set-list fetch", async () => {
    // Caching the rejection would disable printings for the whole session after
    // one flaky call.
    const failing = vi.fn(() => Promise.reject(new Error("offline")));
    vi.stubGlobal("fetch", failing);
    const client = new TcgdexClient();
    await expect(client.resolveSetId("me5", "Pitch Black")).rejects.toBeInstanceOf(ProviderError);

    vi.stubGlobal("fetch", mockFetch({ "/sets": SETS }));
    await expect(client.resolveSetId("me5", "Pitch Black")).resolves.toBe("me05");
  });
});

describe("TcgdexClient.getSetPrintings", () => {
  it("keys printings by collector number", async () => {
    vi.stubGlobal("fetch", mockFetch({ ...CARDS, "/sets/me05": PITCH_BLACK, "/sets": SETS }));
    const result = await new TcgdexClient().getSetPrintings("me5", "Pitch Black");
    expect(result?.tcgdexSetId).toBe("me05");
    expect(result?.byNumber["1"]).toEqual([{ type: "normal" }, { type: "reverse" }]);
  });

  it("indexes both padded and unpadded numbers", async () => {
    // TCGdex pads ("014"), pokemontcg.io does not ("14").
    vi.stubGlobal("fetch", mockFetch({ ...CARDS, "/sets/me05": PITCH_BLACK, "/sets": SETS }));
    const result = await new TcgdexClient().getSetPrintings("me5", "Pitch Black");
    expect(result?.byNumber["14"]).toBeDefined();
    expect(result?.byNumber["014"]).toEqual(result?.byNumber["14"]);
  });

  it("keeps pattern foils as distinct printings", async () => {
    vi.stubGlobal("fetch", mockFetch({ ...CARDS, "/sets/me05": PITCH_BLACK, "/sets": SETS }));
    const result = await new TcgdexClient().getSetPrintings("me5", "Pitch Black");
    expect(result?.byNumber["14"]).toEqual([
      { type: "holo" },
      { type: "reverse", foil: "pokeball" },
      { type: "reverse", foil: "masterball" },
    ]);
  });

  it("skips cards with no usable number", async () => {
    vi.stubGlobal("fetch", mockFetch({ ...CARDS, "/sets/me05": PITCH_BLACK, "/sets": SETS }));
    const result = await new TcgdexClient().getSetPrintings("me5", "Pitch Black");
    expect(Object.keys(result?.byNumber ?? {})).not.toContain("");
  });

  it("returns null when the set cannot be resolved", async () => {
    vi.stubGlobal("fetch", mockFetch({ "/sets": SETS }));
    await expect(new TcgdexClient().getSetPrintings("zzz", "Unknown")).resolves.toBeNull();
  });

  it("keeps the rest of the set when one card fetch fails", async () => {
    // A gap in the denominator beats no denominator at all.
    const partial = { ...CARDS };
    delete partial["/cards/me05-014"];
    vi.stubGlobal("fetch", mockFetch({ ...partial, "/sets/me05": PITCH_BLACK, "/sets": SETS }));
    const result = await new TcgdexClient().getSetPrintings("me5", "Pitch Black");
    expect(result?.byNumber["1"]).toBeDefined();
    expect(result?.byNumber["14"]).toBeUndefined();
  });

  it("reports progress as cards resolve", async () => {
    vi.stubGlobal("fetch", mockFetch({ ...CARDS, "/sets/me05": PITCH_BLACK, "/sets": SETS }));
    const seen: number[] = [];
    await new TcgdexClient().getSetPrintings("me5", "Pitch Black", {
      onProgress: (done, total) => seen.push(total === 3 ? done : -1),
    });
    expect(seen).toEqual([1, 2, 3]);
  });

  it("raises a typed error when the payload is malformed", async () => {
    vi.stubGlobal("fetch", mockFetch({ "/sets/me05": { id: 42 }, "/sets": SETS }));
    await expect(new TcgdexClient().getSetPrintings("me5", "Pitch Black")).rejects.toBeInstanceOf(
      ProviderError,
    );
  });
});
