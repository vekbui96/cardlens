import type { CardSearchResult, CardPriceResult, TradingCard } from "./cards.ts";

/**
 * Multi-game seam. The MVP implements ONLY Pokémon; the registry is structured so
 * additional games slot in without touching UI/input/storage. See
 * docs/adding-new-games.md.
 */
export type TradingCardGame =
  "pokemon" | "yugioh" | "magic" | "one-piece" | "lorcana" | "riftbound" | "sports";

export interface TradingCardGameProvider {
  readonly game: TradingCardGame;
  search(query: string, opts?: { signal?: AbortSignal }): Promise<CardSearchResult[]>;
  getCard(id: string, opts?: { signal?: AbortSignal }): Promise<TradingCard>;
  getPrices(id: string, opts?: { signal?: AbortSignal }): Promise<CardPriceResult>;
}

export interface GameDefinition {
  game: TradingCardGame;
  label: string;
  enabled: boolean;
  createProvider: () => TradingCardGameProvider;
}
