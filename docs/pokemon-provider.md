# Pokémon card data provider

## Chosen API: pokemontcg.io v2

Base URL: `https://api.pokemontcg.io/v2`

| Property    | Value                                                                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Auth        | Optional `X-Api-Key` header. Works keyless. Free key at https://dev.pokemontcg.io lifts limits.                                                                          |
| Rate limits | Keyless: 1,000/day, 30/min. With key: 20,000/day.                                                                                                                        |
| CORS        | `Access-Control-Allow-Origin: *` (verified live) → browser can fetch directly, no proxy needed.                                                                          |
| Metadata    | `name`, `set` (`set.id`, `set.name`, `set.series`, `set.releaseDate`, `set.ptcgoCode`), `number`, `rarity`, `artist`, `supertype`, `subtypes`, `nationalPokedexNumbers`. |
| Images      | `images.small`, `images.large` (on `images.pokemontcg.io`).                                                                                                              |
| Pricing     | Embedded `tcgplayer` (USD) + `cardmarket` (EUR). See [`pricing.md`](pricing.md).                                                                                         |
| SDK         | `pokemon-tcg-sdk-typescript` exists; we use plain `fetch` + Zod to keep deps minimal and validate.                                                                       |

Docs: https://docs.pokemontcg.io/ ·
search syntax: https://docs.pokemontcg.io/api-reference/cards/search-cards/

### Status caveat

pokemontcg.io now points its identity at **Scrydex** ("the natural evolution of the Pokémon TCG
API"). The v2 endpoint is free and working today; the commercial successor is Scrydex. The provider
is isolated behind `CardCatalogProvider` so a future migration touches one file.

## Query syntax used

The `q` parameter is Lucene-like. CardLens builds queries from a normalized user string:

- Name: `name:charizard*` (prefix), exact `!name:"charizard ex"`.
- Collector number: `number:"25"` (detected when the query contains digits or `n/m` form).
- Set: `set.name:"obsidian flames"`.
- Combined example: `name:pikachu* number:25`.
- Shaping: `pageSize` (≤250), `orderBy=-set.releaseDate` as a recency tie-breaker,
  `select=id,name,set,number,rarity,images,tcgplayer,cardmarket` to trim payload.

Response shape: `{ data: Card[], page, pageSize, count, totalCount }`. Validated with Zod
(`integrations/pokemon/schema.ts`); unknown fields are ignored, missing critical fields cause a
typed error surfaced as the network-error state.

## Search normalization

`services/search/normalize.ts`:

- lowercases, trims, collapses whitespace;
- recognizes `ex`, `v`, `vmax`, `vstar`, `gx` suffix tokens;
- extracts a **collector-number token** from patterns like `025`, `4/102`, `223/197`;
- strips punctuation except the number separator.

Examples handled: `Charizard`, `Charizard ex`, `Pikachu 025`, `Charizard 4/102`, `Umbreon VMAX`.

## Ranking

`services/search/rank.ts` scores each candidate and sorts descending:

1. Exact card-name match
2. Name starts with query
3. Collector-number match
4. Set-name match
5. Fuzzy name match (token overlap / Levenshtein-lite)
6. Tie-breaker: release recency, then popularity heuristic

Results are grouped/paged so a broad name (e.g. "Pikachu") never dumps one huge list — the results
screen pages in blocks and the details screen offers "Other printings".

## Providers

- `PokemonTcgIoProvider` — real implementation (fetch + Zod + rank).
- `MockPokemonProvider` — deterministic fixtures (`integrations/pokemon/fixtures.ts`) covering
  Charizard/Pikachu/Umbreon across sets and finishes; used by DevPanel toggles and tests. Selected
  when `import.meta.env.VITEST` or `VITE_USE_MOCKS=true`.

Switch the base URL with `VITE_API_BASE_URL` (default `https://api.pokemontcg.io/v2`; set to your
`server/` proxy `…/api/catalog` to use a server-side key + cache).
