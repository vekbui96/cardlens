import { DEFAULT_GAME, type GameDefinition, type TradingCardGame } from "../../models/games.ts";
import { PokemonGameProvider } from "../pokemon/index.ts";

/**
 * Multi-game registry. ONLY Pokémon is enabled.
 *
 * The storage layer is game-agnostic (rows carry a game; see
 * models/games.ts), but a game still needs a set list, cards in collector
 * order, printings and prices before it can be enabled here — see
 * docs/adding-new-games.md.
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

/** Re-exported so callers have one import site; defined with the type. */
export { DEFAULT_GAME };
