import type { PokemonCardDetails, PokemonCardSummary, CardPriceResult } from "../../models/cards.ts";
import { normalizeQuery } from "../../services/search/normalize.ts";
import { rankResults } from "../../services/search/rank.ts";
import { normalizeTcgplayerPricing } from "../pricing/normalize.ts";
import {
  ProviderError,
  type CardCatalogProvider,
  type CardPricingProvider,
  type FetchOpts,
  type SearchOpts,
} from "../providers.ts";
import { MOCK_CARDS } from "./fixtures.ts";
import { byPriceDesc } from "./sort.ts";
import { toDetails, toRankable } from "./map.ts";

export interface MockBehavior {
  /** Force every call to reject with a network error (DevPanel "Simulate API failure"). */
  failNetwork?: boolean;
  /** Force searches to return nothing (DevPanel "Simulate empty search"). */
  forceEmpty?: boolean;
  /** Artificial latency in ms (DevPanel "Simulate slow network"). */
  latencyMs?: number;
}

/**
 * Deterministic in-memory provider over the fixtures. Selected under tests and
 * when VITE_USE_MOCKS=true; also used by the DevPanel to simulate empty/slow/fail.
 */
export class MockPokemonProvider implements CardCatalogProvider, CardPricingProvider {
  constructor(private behavior: MockBehavior = {}) {}

  setBehavior(behavior: MockBehavior): void {
    this.behavior = behavior;
  }

  private async gate(signal?: AbortSignal): Promise<void> {
    const { latencyMs, failNetwork } = this.behavior;
    if (latencyMs && latencyMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, latencyMs);
        signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }
    if (failNetwork) throw new ProviderError("Simulated network failure", "network");
  }

  async searchCards(query: string, opts?: SearchOpts): Promise<PokemonCardSummary[]> {
    await this.gate(opts?.signal);
    if (this.behavior.forceEmpty) return [];
    const nq = normalizeQuery(query);
    if (!nq.name && !nq.collectorNumber) return [];
    const rankable = MOCK_CARDS.map(toRankable);
    let results = rankResults(query, rankable).filter((c) => {
      // Keep only plausibly-matching cards so mock results feel real.
      const name = c.name.toLowerCase();
      if (nq.name && (name.includes(nq.name) || nq.name.includes(name.split(" ")[0]))) return true;
      if (nq.collectorNumber && c.collectorNumber.replace(/[^\d]/g, "") === nq.collectorNumber) return true;
      return nq.name ? name.startsWith(nq.name.slice(0, 3)) : false;
    });

    const rarities = opts?.rarities;
    if (rarities && rarities.length > 0) {
      const set = new Set(rarities);
      results = results.filter((c) => (c.rarity ? set.has(c.rarity) : false)).sort(byPriceDesc);
    }
    return results;
  }

  async getCard(id: string, opts?: FetchOpts): Promise<PokemonCardDetails> {
    await this.gate(opts?.signal);
    const raw = MOCK_CARDS.find((c) => c.id === id);
    if (!raw) throw new ProviderError(`Mock card not found: ${id}`, "not-found");
    return toDetails(raw);
  }

  async getPrices(cardId: string, opts?: FetchOpts): Promise<CardPriceResult> {
    await this.gate(opts?.signal);
    const raw = MOCK_CARDS.find((c) => c.id === cardId);
    if (!raw) throw new ProviderError(`Mock card not found: ${cardId}`, "not-found");
    return normalizeTcgplayerPricing(raw.tcgplayer);
  }
}
