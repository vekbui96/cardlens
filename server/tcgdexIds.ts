/**
 * TCGdex card ids → pokemontcg.io card ids.
 *
 * Mault (the photo engine) indexes TCGdex; CardLens files everything under
 * pokemontcg.io ids. The two schemes agree for most sets and differ in a few
 * mechanical ways, observed against Mault's own answers on 2026-11-18:
 *
 *   sv01-001     → sv1-1          zero-padded set number and card number
 *   sv03.5-006   → sv3pt5-6       ".5" sub-sets are "pt5" on modern sets…
 *   swsh3.5-56   → swsh35-56      …and a bare "5" on older ones
 *   ecard2-H01   → ecard2-H1      padding inside an alphanumeric number
 *   swshp-SWSH050, smp-SM60, xy1-1  already identical
 *
 * **String rules alone are not trusted.** They only GENERATE candidates; a
 * candidate counts only if it exists in CardLens's own card index (`known`).
 * Where none resolves the card is dropped rather than guessed, because a
 * plausible-looking wrong id would file the wrong card — the one failure the
 * scanner is built to avoid.
 */

/**
 * Whole-set renames no mechanical rule produces. Small on purpose: an entry
 * here is a claim about two catalogues, and an unvalidated claim is exactly
 * what the `known` check exists to stop — so these still have to resolve.
 */
const SET_ALIASES: Record<string, string[]> = {
  // Legendary Collection: "lc" in TCGdex, the sixth base-era set in pokemontcg.io.
  lc: ["base6"],
};

/** "001" → "1", "H01" → "H1", "SWSH050" → "SWSH50". Never strips to empty. */
function unpad(part: string): string {
  return part.replace(/^([A-Za-z]*)0+(\d)/, "$1$2");
}

function setVariants(set: string): string[] {
  const out = new Set<string>([set]);
  for (const alias of SET_ALIASES[set] ?? []) out.add(alias);
  // sv01 → sv1, me01 → me1. Only the trailing digit run.
  const unpadded = set.replace(/^([a-z]+)0+(\d)/, "$1$2");
  out.add(unpadded);
  for (const s of [set, unpadded]) {
    const half = /^(.*\d)\.5$/.exec(s);
    if (half) {
      out.add(`${half[1]}pt5`); // sv3pt5, swsh12pt5
      out.add(`${half[1]}5`); // swsh35, sm75, sm115
    }
  }
  return [...out];
}

function numberVariants(num: string): string[] {
  return [...new Set([num, unpad(num)])];
}

/**
 * Every pokemontcg.io id this TCGdex id might be, most literal first.
 * Exported for tests; callers want `toPokemonTcgId`.
 */
export function pokemonTcgCandidates(tcgdexId: string): string[] {
  const dash = tcgdexId.lastIndexOf("-");
  if (dash <= 0 || dash === tcgdexId.length - 1) return [tcgdexId];
  const set = tcgdexId.slice(0, dash);
  const num = tcgdexId.slice(dash + 1);
  const out: string[] = [];
  for (const s of setVariants(set)) for (const n of numberVariants(num)) out.push(`${s}-${n}`);
  return [...new Set(out)];
}

/** The pokemontcg.io id for a TCGdex id, or null when none exists in the index. */
export function toPokemonTcgId(tcgdexId: string, known: (id: string) => boolean): string | null {
  for (const candidate of pokemonTcgCandidates(tcgdexId)) {
    if (known(candidate)) return candidate;
  }
  return null;
}
