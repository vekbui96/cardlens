# CardLens architecture

CardLens is a single-page React app that behaves like a small **screen state machine** driven by
**directional input events**. Everything platform-specific (Meta input, data sources, text entry)
is hidden behind interfaces so the UI stays portable and testable.

## Layers

```
src/
  app/          App root, providers, tiny router, screen state machine
  components/   Reusable UI: GlassesFrame, DevPanel, FocusList, PriceBlock, Loading/Error/Empty
  features/     One folder per screen: home, search, results, card-details, favorites, recent
  integrations/
    meta/       WearableInputAdapter + Meta/Keyboard/Mock adapters (keyboard-event based)
    pokemon/    CardCatalogProvider + PokemonTcgIo/Mock providers, Zod schemas, ranking
    pricing/    CardPricingProvider + normalization to CardPriceResult
  services/     search (debounce/cancel/rank), text-input providers, cache helpers
  storage/      versioned localStorage repositories + migration
  hooks/        useWearableInput, useFocusList, useCatalogSearch, useCardDetails, favorites, recent
  models/       shared TS types + Zod schemas + game registry
  pages/        companion (/input/:code), privacy (/privacy)
  styles/       design tokens + global CSS
server/         Express: companion session relay (short-poll) + optional API proxy/cache
```

## The three core seams

### 1. Input — `WearableInputAdapter`

```ts
interface WearableInputAdapter {
  subscribe(listener: (event: WearableInputEvent) => void): () => void;
}
type WearableInputEvent =
  | { type: "SWIPE_UP" }
  | { type: "SWIPE_DOWN" }
  | { type: "SWIPE_LEFT" }
  | { type: "SWIPE_RIGHT" }
  | { type: "SELECT" }
  | { type: "BACK" };
```

Implementations:

- **`MetaWearableInputAdapter`** — production. Listens to `window` `keydown` and maps
  `Arrow*`/`Enter`/`Escape` to events. This is exactly what the glasses OS emits, so it also works
  on desktop. Ignores events while focus is in a real `<input>` (companion page).
- **`KeyboardInputAdapter`** — explicit desktop dev adapter (same mapping; named for clarity and to
  match the spec). In practice it delegates to the shared keyboard source.
- **`MockInputAdapter`** — programmatic. The `DevPanel` and unit/Playwright tests push events
  through it without synthesizing DOM keys.

UI never reads `keydown`. It calls `useWearableInput(handler)` and receives normalized events.

### 2. Data — `CardCatalogProvider` / `CardPricingProvider`

```ts
interface CardCatalogProvider {
  searchCards(query: string, opts?: { signal?: AbortSignal }): Promise<PokemonCardSummary[]>;
  getCard(id: string, opts?: { signal?: AbortSignal }): Promise<PokemonCardDetails>;
}
interface CardPricingProvider {
  getPrices(cardId: string, opts?: { signal?: AbortSignal }): Promise<CardPriceResult>;
}
```

- **`PokemonTcgIoProvider`** — real, calls `api.pokemontcg.io/v2` (or the proxy via
  `VITE_API_BASE_URL`), validates responses with Zod, ranks results, and derives normalized prices.
- **`MockPokemonProvider`** — deterministic fixtures used by the DevPanel "empty/failure" toggles,
  Storybook-less previews, and tests. Selected automatically under Vitest/`VITE_USE_MOCKS`.

TanStack Query wraps these (caching, cancellation, retry, stale markers).

### 3. Text entry — `TextInputProvider`

```ts
interface TextInputProvider {
  isSupported(): boolean;
  requestInput(options: {
    title: string;
    placeholder: string;
    initialValue?: string;
  }): Promise<string | null>;
}
```

- **`UnsupportedTextInputProvider`** — glasses default; `isSupported() === false`. UI falls back to
  recents/favorites/popular/alphabetical browse.
- **`BrowserPromptTextInputProvider`** — desktop/mobile dev; uses an in-app modal (not `window.prompt`,
  to keep focus model consistent and testable).
- **`CompanionPhoneTextInputProvider`** — shows a session code/QR; the phone submits text through the
  `server/` relay; resolves when the phone posts a value.

The active provider is chosen by capability detection (`selectTextInputProvider()`), so screens ask
for text without knowing the mechanism.

## Screen state machine

`app/navigation` holds a stack of screens: `home → search → results → details`, plus `favorites`
and `recent` reachable from home. `BACK` pops the stack. Each screen is a pure component that
receives the current focus index and dispatches `navigate`/`select` intents. This keeps navigation
deterministic and unit-testable (`reducer.test.ts`).

## Multi-game seam

```ts
type TradingCardGame = "pokemon" | "yugioh" | "magic" | "one-piece" | "lorcana" | "riftbound" | "sports";
interface TradingCardGameProvider {
  game: TradingCardGame;
  search(query: string): Promise<CardSearchResult[]>;
  getCard(id: string): Promise<TradingCard>;
  getPrices(id: string): Promise<CardPriceResult>;
}
```

Only `pokemon` is registered (`models/games.ts`). See
[`adding-new-games.md`](adding-new-games.md).

## Data flow (search example)

```
user picks "Charizard" (recent/popular/companion/prompt)
  → useCatalogSearch(query)            debounce + AbortController via TanStack Query
    → PokemonTcgIoProvider.searchCards  fetch api.pokemontcg.io, Zod-validate
      → rankResults()                   exact > startsWith > number > set > fuzzy > recency
        → results screen (FocusList)    swipe to move focus, pinch to select
          → useCardDetails(id)          card + normalized CardPriceResult
            → details screen            market/low/mid, finish label, source, updatedAt
```

## Caching & storage

- `localStorage` repositories are **versioned** (`cardlens:v1:*`); unknown/corrupt data is discarded
  safely on read (`safeParse`), and a migration hook upgrades older versions.
- Price cache TTL 15–60 min (default 30); card-metadata cache TTL 7 days. Cached prices render
  immediately and are marked **stale** past TTL while a refresh runs.

## Why a backend at all

The catalog + pricing API is open-CORS and keyless, so the core app needs **no** backend. `server/`
exists only for (a) the companion-phone relay (needs shared session state) and (b) an optional proxy
that attaches a server-side API key + cache. Neither ships secrets to the browser. See
[`pokemon-provider.md`](pokemon-provider.md) and the README.
