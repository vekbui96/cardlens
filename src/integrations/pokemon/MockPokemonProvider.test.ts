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
});
