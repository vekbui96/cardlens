# Adding new games

CardLens ships **Pokémon only**. This file used to claim a second game slots in without touching
UI or storage. That was true of the app it described — card search — and stopped being true when
CardLens became a master-set collection tracker. What follows is what is actually true now.

## What is genuinely game-agnostic

The **storage and sync layer**. A collection row carries the game it belongs to:

```ts
interface OwnedPrinting {
  cardId: string;
  setId: string;
  finish: CollectFinish;
  game?: TradingCardGame; // omitted for pokemon — see below
  at: number;
  deletedAt?: number;
}
```

- **Absence means Pokémon**, resolved by `canonicalGame` on read (`src/models/games.ts`). No row
  already on a device or on the server needs rewriting, and none ever will.
- The game is **omitted when it is the default** rather than written out. The cap is 20,000 rows
  and this app has already had localStorage run out and silently swallow marks; a redundant field
  on every row is not free.
- `printingKey` — the OR-Set key — includes the resolved game. It is **computed, never stored**,
  which is what made it safe to grow a segment: an old row produces the identical key it always
  did. Two games cannot collide on a shared card id, and one game's tombstone cannot delete
  another game's card.
- `Repositories` takes the active game. **Views are scoped to it** (`getCollection`, `isOwned`,
  the per-set counts) so no count can mix games. **`getPrintings` is not** — sync pushes every row
  the device holds, because a device that withheld another game's rows would look to the server
  exactly like one that had deleted them.
- The server preserves and validates the field (`server/collectionStore.ts`). `parseRow` is a
  whitelist, so this is load-bearing: without it a second game's rows come back belonging to the
  first. An unrecognised value falls back to the default rather than being stored — the endpoint is
  public, and an arbitrary string would partition the OR-Set into keys no client looks under.

## What is NOT agnostic, and is the actual work

`TradingCardGameProvider` (`search`/`getCard`/`getPrices`) is the search-era seam. Implementing it
does **not** get you a game, because the tracker asks four different questions:

| Question                              | Pokémon answer today                   |
| ------------------------------------- | -------------------------------------- |
| Which sets exist?                     | pokemontcg.io, via the server proxy    |
| Which cards, in collector order?      | pokemontcg.io / the aggregate endpoint |
| **Which printings does a card have?** | **TCGdex, one request per card**       |
| What is each printing worth?          | TCGdex, then pokemontcg.io as fallback |

The third row is where the difficulty lives, and it has no cross-game answer yet.

## The source that probably solves it

**tcgcsv.com** — already used for sealed prices — republishes TCGplayer's daily dump for every
category, not just Pokémon. Measured 2026-08-02, all live and refreshed daily:

```
Magic 1   YuGiOh 2   Pokemon 3   Flesh & Blood 62   Digimon 63
One Piece 68   Lorcana 71   Pokemon Japan 85   Riftbound 89
```

Probed against Pitch Black (group 24688) it returns the whole model in one shape:

```
120 card products, each with extendedData Number ("001/084") and Rarity
220 price rows across Normal / Reverse Holofoil / Holofoil
imageUrl on every product (tcgplayer-cdn, 200w)
```

Sets, cards, collector numbers, printings, prices and art — from one source, for every game listed
above. Worth knowing: pokemontcg.io returns `prices: {}` for all 120 of those cards, so tcgcsv is
arguably a better Pokémon oracle than either source currently in the stack.

**The catch:** zero pattern-foil products in that set — no Poké Ball, no Master Ball. Per-printing
tracking including pattern foils is the app's most distinctive feature and the reason TCGdex is in
the stack at all. tcgcsv is therefore a third pillar for Pokémon, not a replacement. For other
games it mostly does not arise: One Piece and Lorcana are Normal/Foil, which is why they are the
easier first game, not the harder one.

Note tcgcsv 401s the default Python `urllib` user-agent, the same trap as pokemontcg.io.

## Steps to add a game

1. Pick the data source and document it in `docs/<game>-provider.md` (ToS, auth, rate limits, CORS,
   fields, pricing source) — mirror `pokemon-provider.md`.
2. Answer the four questions in the table above. Until a set list, cards in collector order,
   printings per card and a price per printing exist, nothing else is worth building.
3. Build it for **one** game end to end before generalising anything. The provider interface below
   was designed ahead of a second implementation and is the wrong shape as a result; do not repeat
   that by inventing a second abstraction with no consumer.
4. Register it in `GAME_REGISTRY` with `enabled: true`, and add a game selector once more than one
   is enabled.
5. Fixtures and unit tests mirroring the Pokémon suite.

## What you still never have to change

- Input adapters and navigation — games are pure data.
- The `TextInputProvider` stack.
- The collection storage format, the merge rule, or the sync protocol (see above).
- The GlassesFrame/DevPanel preview.

## Pricing caution across games

Finishes and marketplaces differ per game (MTG foil/etched, One Piece parallels, sports raw vs
graded). Keep the "never mix finishes / never mix raw vs graded / label the source" rules from
[`pricing.md`](pricing.md) per game. Do not reuse Pokémon finish keys for another game — the finish
string is deliberately not an enum, so nothing stops you, and nothing will tell you either.
