import type { PokemonCardSummary } from "../../models/cards.ts";

interface HasCollectorNumber {
  collectorNumber: string;
}

/** Sort by headline market price, highest first; cards without a price go last. */
export function byPriceDesc(a: PokemonCardSummary, b: PokemonCardSummary): number {
  const pa = a.marketPrice ?? -1;
  const pb = b.marketPrice ?? -1;
  return pb - pa;
}

/**
 * Sort by collector number ascending — binder order, which is how a set is
 * actually worked through when collecting.
 *
 * Numbers are strings and not always numeric: "101a", "TG01", "SV001", "H12".
 * So compare the leading digits numerically and fall back to comparing the
 * whole string, which keeps "1, 2, 10" in order instead of "1, 10, 2" while
 * still grouping lettered subsets sensibly.
 */
/**
 * Typed to the field it reads, not to PokemonCardSummary. The owned-printings
 * list sorts rows that carry a collector number but are not cards, and the
 * lettered-prefix rules here are exactly the ones it must not reimplement.
 */
export function byCollectorNumber(a: HasCollectorNumber, b: HasCollectorNumber): number {
  const pa = parseCollectorNumber(a.collectorNumber);
  const pb = parseCollectorNumber(b.collectorNumber);

  // Cards with a letter prefix (TG01, SV001) form their own runs at the end.
  if (pa.prefix !== pb.prefix) return pa.prefix.localeCompare(pb.prefix);
  if (pa.value !== pb.value) return pa.value - pb.value;
  return pa.suffix.localeCompare(pb.suffix);
}

function parseCollectorNumber(raw: string): { prefix: string; value: number; suffix: string } {
  const m = /^([A-Za-z]*)(\d*)(.*)$/.exec(raw ?? "");
  return {
    prefix: (m?.[1] ?? "").toUpperCase(),
    // No digits at all sorts last rather than colliding at 0.
    value: m?.[2] ? Number(m[2]) : Number.MAX_SAFE_INTEGER,
    suffix: (m?.[3] ?? "").toLowerCase(),
  };
}
