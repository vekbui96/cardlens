import type { PokemonSet } from "./cards.ts";

/** Lower-case and strip accents, so "pokemon" finds "Pokémon". */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Whether a set matches what the collector typed in the Sets list's Find box.
 * Looks at name, id, code and series; a blank query matches everything.
 */
export function matchesSetQuery(
  set: Pick<PokemonSet, "id" | "name" | "code" | "series">,
  query: string,
): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  return [set.name, set.id, set.code, set.series].some((f) => f !== undefined && fold(f).includes(q));
}
