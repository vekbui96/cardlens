import type { CompletionTier, OwnedInSet, SetTiers } from "../../models/setCompletion.ts";

/**
 * How a completion tier is spelled on screen, and how sets carrying one rank.
 *
 * `models/setCompletion.ts` decides WHETHER a set is complete; this decides what
 * the screens do with the answer. It is deliberately tiny and colour-free —
 * every surface reads the same word from here so "base" cannot mean one thing on
 * Home and another on the set list.
 */

/**
 * The word that carries the tier when colour cannot.
 *
 * Green (base) and gold (master) is a pair that fails the common red-green
 * deficiencies — a deutan sees two yellows. `web-theme.css` requires state to be
 * paired with a glyph or a label for exactly this reason, so nothing may draw a
 * completion colour without printing this word beside it.
 */
export function tierLabel(tier: CompletionTier): "BASE" | "MASTER" | null {
  return tier === "master" ? "MASTER" : tier === "base" ? "BASE" : null;
}

/** Higher is more finished. `master` implies base, so it outranks it. */
export function tierRank(tier: CompletionTier): number {
  return tier === "master" ? 2 : tier === "base" ? 1 : 0;
}

/**
 * The ratio a row DRAWS: base where the set has a base tier, master otherwise.
 *
 * Sorting on `baseRatio` alone would sink every single-tier set (Base, 102/102 —
 * no secrets, so no separate base milestone) below every set that has one, at
 * any progress. The bar and the order have to agree about what "closest" means.
 */
export function shownRatio(tiers: SetTiers): number | undefined {
  return tiers.baseRatio ?? tiers.masterRatio;
}

/**
 * Closest to finished first: tier, then the ratio on the bar, then master, then
 * raw cards held.
 *
 * Once the ratio is base, every base-complete set ties at 1.0 — so the tier has
 * to lead, or a master-complete set would shuffle in among the merely base-
 * complete ones by whatever the tie-break happened to be.
 */
export function compareCompletion(
  a: { tiers: SetTiers; owned: number },
  b: { tiers: SetTiers; owned: number },
): number {
  return (
    tierRank(b.tiers.tier) - tierRank(a.tiers.tier) ||
    (shownRatio(b.tiers) ?? -1) - (shownRatio(a.tiers) ?? -1) ||
    (b.tiers.masterRatio ?? -1) - (a.tiers.masterRatio ?? -1) ||
    b.owned - a.owned
  );
}

/**
 * What to hand `setTiers` for one set.
 *
 * The collector numbers when the library has one for EVERY owned card, and the
 * plain count otherwise — `setTiers` then declines the base tier rather than
 * dividing a numerator full of secret rares by a base denominator.
 *
 * The length check is not belt-and-braces. `ownedNumbersBySet` omits any card
 * whose number is unknown rather than guessing it, which is right, but the list
 * is also the MASTER numerator inside `setTiers` — so a collection marked before
 * numbers were recorded would hand over three numbers for a set holding two
 * hundred cards and the master figure would collapse from 197/230 to 3/230. A
 * short list can size neither tier honestly, so it sizes neither: the set falls
 * back to exactly what it showed before there were two tiers.
 */
export function ownedIn(setId: string, numbersBySet: Record<string, string[]>, count: number): OwnedInSet {
  const numbers = numbersBySet[setId];
  return numbers !== undefined && numbers.length === count ? numbers : count;
}
