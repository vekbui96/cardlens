import type { CardSearchResult, CardPriceResult, TradingCard } from "./cards.ts";

/**
 * Which games the data model can express. Pokémon is the only one implemented.
 *
 * Listing the rest is not a promise that they work — it is what lets a stored
 * row say which game it belongs to, so that adding one later is a feature
 * rather than a migration of everything already saved.
 */
export const TRADING_CARD_GAMES = [
  "pokemon",
  "yugioh",
  "magic",
  "one-piece",
  "lorcana",
  "riftbound",
  "sports",
] as const;

export type TradingCardGame = (typeof TRADING_CARD_GAMES)[number];

export const DEFAULT_GAME: TradingCardGame = "pokemon";

/**
 * The game a stored value means, defaulting to Pokémon.
 *
 * Every row written before games existed carries no `game` field, and
 * rewriting them all to add one would be a migration across every device and
 * the server for no gain — so absence IS Pokémon, resolved on read. This
 * mirrors `canonicalFinish`, and for the same reason: the collection has to
 * survive being read by a build older or newer than the one that wrote it.
 *
 * Deliberately total. An unrecognised game — a hostile payload, or a newer
 * client — resolves to the default instead of throwing, because the
 * alternative is one bad row taking down a merge carrying thousands of good
 * ones.
 */
export function canonicalGame(value: unknown): TradingCardGame {
  return (TRADING_CARD_GAMES as readonly string[]).includes(value as string)
    ? (value as TradingCardGame)
    : DEFAULT_GAME;
}

/**
 * The search-era provider seam.
 *
 * NOTE: implementing this is NOT enough to add a game. It was written when the
 * app was card search; the app is now a master-set tracker, and what a second
 * game has to supply is sets, cards in collector order, WHICH PRINTINGS each
 * card has, and a price per printing. None of that is here.
 * See docs/adding-new-games.md, which describes the surface that actually
 * matters.
 */
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
