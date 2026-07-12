# Adding new games

CardLens ships **Pokémon only**, but is structured so other trading-card games slot in without
touching the UI or the input/navigation layers.

## The contract

```ts
type TradingCardGame = "pokemon" | "yugioh" | "magic" | "one-piece" | "lorcana" | "riftbound" | "sports";

interface TradingCardGameProvider {
  game: TradingCardGame;
  search(query: string, opts?: { signal?: AbortSignal }): Promise<CardSearchResult[]>;
  getCard(id: string, opts?: { signal?: AbortSignal }): Promise<TradingCard>;
  getPrices(id: string, opts?: { signal?: AbortSignal }): Promise<CardPriceResult>;
}
```

`CardSearchResult`, `TradingCard`, and `CardPriceResult` are game-neutral models in
`src/models/`. The Pokémon-specific `PokemonCardSummary`/`PokemonCardDetails` are adapters onto the
neutral models.

## Registry

`src/models/games.ts` holds a registry keyed by `TradingCardGame`. Only `pokemon` is registered:

```ts
export const GAME_REGISTRY: Partial<Record<TradingCardGame, GameDefinition>> = {
  pokemon: {
    game: "pokemon",
    label: "Pokémon",
    enabled: true,
    createProvider: () => new PokemonGameProvider(),
  },
};
```

Screens read `GAME_REGISTRY` to build any future game switcher. Because only Pokémon is `enabled`,
no game-picker UI is shown in the MVP (single-game fast path).

## Steps to add a game (e.g. Lorcana)

1. Pick a data/pricing API and document it in a new `docs/<game>-provider.md` (ToS, auth, rate
   limits, CORS, fields, pricing source) — mirror `pokemon-provider.md`.
2. Create `src/integrations/<game>/` with:
   - Zod schemas for the API,
   - a `<Game>GameProvider implements TradingCardGameProvider`,
   - `normalize`/`rank` mapping the API onto the neutral models and `CardPriceResult`.
3. Register it in `GAME_REGISTRY` with `enabled: true`.
4. If >1 game is enabled, add a game selector to the home screen focus ring (the FocusList already
   supports arbitrary items — no new input code).
5. Add fixtures + unit tests (normalization, ranking, pricing) mirroring the Pokémon suite.

## What you never have to change

- Input adapters / navigation (games are pure data).
- The `TextInputProvider` stack.
- Storage schema (favorites/recents are keyed by `{ game, cardId }`; already game-aware).
- The GlassesFrame/DevPanel preview.

## Pricing caution across games

Each game's finishes and marketplaces differ (MTG foil/etched, One Piece parallels, sports
raw/graded). Keep the "never mix finishes / never mix raw vs graded / label the source" rules from
[`pricing.md`](pricing.md) per game. Do not reuse Pokémon finish keys for other games.
