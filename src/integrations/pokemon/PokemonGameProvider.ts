import type { CardSearchResult, TradingCard, CardPriceResult } from "../../models/cards.ts";
import type { TradingCardGame, TradingCardGameProvider } from "../../models/games.ts";
import type { CardCatalogProvider, CardPricingProvider, FetchOpts } from "../providers.ts";
import { createPokemonCatalog } from "./index.ts";

/**
 * Adapts the Pokémon catalog/pricing providers onto the game-neutral
 * TradingCardGameProvider contract used by the multi-game registry. This is the
 * ONLY game implemented in the MVP.
 */
export class PokemonGameProvider implements TradingCardGameProvider {
  readonly game: TradingCardGame = "pokemon";
  private readonly provider: CardCatalogProvider & CardPricingProvider;

  constructor(provider: (CardCatalogProvider & CardPricingProvider) | undefined = createPokemonCatalog()) {
    this.provider = provider;
  }

  async search(query: string, opts?: FetchOpts): Promise<CardSearchResult[]> {
    const cards = await this.provider.searchCards(query, opts);
    return cards.map((c) => ({
      id: c.id,
      name: c.name,
      setName: c.setName,
      collectorNumber: c.collectorNumber,
      ...(c.rarity ? { rarity: c.rarity } : {}),
      ...(c.imageSmall ? { imageSmall: c.imageSmall } : {}),
    }));
  }

  async getCard(id: string, opts?: FetchOpts): Promise<TradingCard> {
    const c = await this.provider.getCard(id, opts);
    return {
      id: c.id,
      name: c.name,
      setName: c.setName,
      setCode: c.setCode,
      collectorNumber: c.collectorNumber,
      ...(c.rarity ? { rarity: c.rarity } : {}),
      ...(c.imageSmall ? { imageSmall: c.imageSmall } : {}),
      ...(c.imageLarge ? { imageLarge: c.imageLarge } : {}),
      ...(c.artist ? { artist: c.artist } : {}),
      ...(c.releaseDate ? { releaseDate: c.releaseDate } : {}),
    };
  }

  getPrices(id: string, opts?: FetchOpts): Promise<CardPriceResult> {
    return this.provider.getPrices(id, opts);
  }
}
