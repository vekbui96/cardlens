import { describe, expect, it } from "vitest";
import { MockPokemonProvider } from "./MockPokemonProvider.ts";
import { ProviderError } from "../providers.ts";

describe("MockPokemonProvider", () => {
  it("finds Charizard cards ranked with an exact/starts-with lead", async () => {
    const provider = new MockPokemonProvider();
    const results = await provider.searchCards("Charizard");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((c) => c.name.toLowerCase().includes("chari"))).toBe(true);
    expect(results[0].name.toLowerCase().startsWith("charizard")).toBe(true);
  });

  it("attaches a headline market price to result rows", async () => {
    const provider = new MockPokemonProvider();
    const [top] = await provider.searchCards("Umbreon");
    expect(top.marketPrice).toBeGreaterThan(0);
  });

  it("returns empty for a blank query", async () => {
    const provider = new MockPokemonProvider();
    expect(await provider.searchCards("   ")).toEqual([]);
  });

  it("honors forceEmpty behavior", async () => {
    const provider = new MockPokemonProvider({ forceEmpty: true });
    expect(await provider.searchCards("Charizard")).toEqual([]);
  });

  it("throws a network ProviderError when failNetwork is set", async () => {
    const provider = new MockPokemonProvider({ failNetwork: true });
    await expect(provider.searchCards("Charizard")).rejects.toBeInstanceOf(ProviderError);
  });

  it("normalizes prices for a known card", async () => {
    const provider = new MockPokemonProvider();
    const prices = await provider.getPrices("sv3-223");
    expect(prices.marketPrice).toBe(58.42);
    expect(prices.source).toContain("TCGplayer");
    expect(prices.lastUpdated).toBe("2026-07-11T00:00:00.000Z");
  });

  it("throws not-found for unknown card ids", async () => {
    const provider = new MockPokemonProvider();
    await expect(provider.getCard("does-not-exist")).rejects.toBeInstanceOf(ProviderError);
  });

  it("filters results by rarity", async () => {
    const provider = new MockPokemonProvider();
    const results = await provider.searchCards("Charizard", { rarities: ["Special Illustration Rare"] });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((c) => c.rarity === "Special Illustration Rare")).toBe(true);
  });

  it("sorts rarity-filtered results by market price (highest first)", async () => {
    const provider = new MockPokemonProvider();
    // Both Obsidian Flames Charizards are matched, but different rarities; use a
    // rarity present on multiple cards to observe ordering.
    const results = await provider.searchCards("Charizard", { rarities: ["Rare Holo V", "Rare Holo VMAX"] });
    const prices = results.map((c) => c.marketPrice ?? 0);
    const sorted = [...prices].sort((a, b) => b - a);
    expect(prices).toEqual(sorted);
  });

  it("returns nothing when no card matches the rarity", async () => {
    const provider = new MockPokemonProvider();
    expect(await provider.searchCards("Charizard", { rarities: ["Illustration Rare"] })).toEqual([]);
  });
});
