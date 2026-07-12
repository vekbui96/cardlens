import { POKEMON_NAMES } from "./pokemonNames.data.ts";

export { POKEMON_NAMES } from "./pokemonNames.data.ts";

/**
 * Prefix-first autocomplete over the bundled Pokémon name list. "starts with"
 * matches rank above "contains" matches; results are de-duplicated and capped.
 * Case-insensitive; ignores a leading article of whitespace.
 */
export function suggestPokemon(query: string, limit = 5): string[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const startsWith: string[] = [];
  const contains: string[] = [];
  for (const name of POKEMON_NAMES) {
    const lower = name.toLowerCase();
    if (lower.startsWith(q)) startsWith.push(name);
    else if (lower.includes(q)) contains.push(name);
    if (startsWith.length >= limit) break;
  }

  const merged = [...startsWith];
  for (const name of contains) {
    if (merged.length >= limit) break;
    merged.push(name);
  }
  return merged.slice(0, limit);
}
