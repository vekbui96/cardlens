import type { GameDefinition, TradingCardGame } from "../../models/games.ts";
import { PokemonGameProvider } from "../pokemon/index.ts";

/**
 * Multi-game registry. ONLY Pokémon is enabled in the MVP. Additional games slot
 * in here (see docs/adding-new-games.md) without touching UI/input/storage.
 */
export const GAME_REGISTRY: Partial<Record<TradingCardGame, GameDefinition>> = {
  pokemon: {
    game: "pokemon",
    label: "Pokémon",
    enabled: true,
    createProvider: () => new PokemonGameProvider(),
  },
};

export function enabledGames(): GameDefinition[] {
  return Object.values(GAME_REGISTRY).filter((g): g is GameDefinition => !!g && g.enabled);
}

export const DEFAULT_GAME: TradingCardGame = "pokemon";
