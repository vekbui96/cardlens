import { describe, expect, it } from "vitest";
import { decodeShowcase, encodeShowcase, showcaseIndex, type Showcase } from "./showcase.ts";

const round = (owned: Showcase["owned"]) => decodeShowcase("me5", encodeShowcase({ setId: "me5", owned }));

describe("showcase links", () => {
  it("round-trips the printings it was given", () => {
    const owned = [
      { collectorNumber: "1", finish: "normal" as const },
      { collectorNumber: "1", finish: "reverse" as const },
      { collectorNumber: "120", finish: "holo" as const },
    ];
    expect(round(owned).owned).toEqual(owned);
  });

  it("survives the collector numbers that are not numbers", () => {
    // 101a, TG01 and SV001 all exist. A format that assumed digits would drop
    // exactly the cards worth showing off.
    const owned = [
      { collectorNumber: "101a", finish: "reverse" as const },
      { collectorNumber: "TG01", finish: "holo" as const },
      { collectorNumber: "SV001", finish: "normal" as const },
    ];
    expect(round(owned).owned).toEqual(owned);
  });

  it("carries a pattern foil it has no short code for", () => {
    // Sets keep inventing foils, so an unknown one must ride as its full name
    // rather than being silently dropped.
    const owned = [{ collectorNumber: "7", finish: "reverse:masterball" as const }];
    expect(round(owned).owned).toEqual(owned);
  });

  it("canonicalises legacy finishes so an old device shares the same link", () => {
    const decoded = round([{ collectorNumber: "4", finish: "holofoil" as CollectFinishLike }]);
    expect(decoded.owned).toEqual([{ collectorNumber: "4", finish: "holo" }]);
  });

  it("drops duplicates rather than repeating them in the URL", () => {
    const owned = [
      { collectorNumber: "1", finish: "normal" as const },
      { collectorNumber: "1", finish: "normal" as const },
    ];
    expect(round(owned).owned).toHaveLength(1);
  });

  it("is URL-safe", () => {
    const payload = encodeShowcase({
      setId: "me5",
      owned: [{ collectorNumber: "1", finish: "reverse:pokeball" }],
    });
    expect(payload).toMatch(/^[A-Za-z0-9_-]*$/);
    expect(encodeURIComponent(payload)).toBe(payload);
  });

  it("stays short enough to paste", () => {
    // A full 250-card set, every card in two printings — the worst realistic
    // case. Chat clients start mangling links well before 8000 characters.
    const owned = Array.from({ length: 250 }, (_, i) => i + 1).flatMap((n) => [
      { collectorNumber: String(n), finish: "normal" as const },
      { collectorNumber: String(n), finish: "reverse" as const },
    ]);
    expect(encodeShowcase({ setId: "me5", owned }).length).toBeLessThan(4000);
  });

  it("returns what it could read from a mangled link instead of failing", () => {
    // Chat clients wrap, shorten and linkify. A showcase missing three cards is
    // still worth looking at; an error page is not.
    const good = encodeShowcase({
      setId: "me5",
      owned: [
        { collectorNumber: "1", finish: "normal" },
        { collectorNumber: "2", finish: "normal" },
      ],
    });
    expect(decodeShowcase("me5", good.slice(0, good.length - 2)).owned.length).toBeGreaterThanOrEqual(1);
    expect(decodeShowcase("me5", "!!!not base64!!!").owned).toEqual([]);
    expect(decodeShowcase("me5", "").owned).toEqual([]);
  });

  it("indexes for lookup by number and finish", () => {
    const index = showcaseIndex({
      setId: "me5",
      owned: [{ collectorNumber: "12", finish: "reverse" }],
    });
    expect(index.has("12|reverse")).toBe(true);
    expect(index.has("12|normal")).toBe(false);
  });
});

/** Legacy stored values are strings the current type no longer names. */
type CollectFinishLike = Parameters<typeof encodeShowcase>[0]["owned"][number]["finish"];
