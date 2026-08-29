/**
 * Two ways to "finish" a set, and one predicate that decides both.
 *
 * A set publishes two sizes. `printedTotal` is the denominator on the card
 * itself ("12/84"); `total` counts everything the set actually contains,
 * secret rares and over-number cards included. Collectors treat those as two
 * different achievements:
 *
 * - **base** — one printing of each card up to `printedTotal`. The achievable
 *   milestone, and the one most people mean by "I completed the set".
 * - **master** — the whole set, `total` cards. What this app has always
 *   tracked, unchanged.
 *
 * Everything that draws a bar, a percentage or a star must come through here.
 * There used to be three separate expressions for "is this set complete"
 * (`ratio === 1`, a rounded `pct === 100`, and `owned === total`) and they
 * disagreed: a set at 99.7% rounded to "100%" on two screens and showed no
 * star on the third.
 *
 * ## Classification
 *
 * Measured across 154 index-complete sets, this rule agrees with
 * `total - printedTotal` for 98.7% of them:
 *
 *     base ⟺ /^\d+$/.test(number) && Number(number) <= printedTotal
 *
 * Every NON-NUMERIC number is over-number — `TG01`, `SWSH001`, `H1`, `88a`.
 * That is 7.75% of all collector numbers, and counting them as over-number is
 * what closes all 35 remaining discrepancies. The only genuine failures are the
 * all-alphanumeric promo sets (`xyp`, `smp`), where the rule finds zero base
 * cards; `setCardNumbers` below exists to detect exactly that and decline.
 */

/**
 * The sizes a set publishes about itself.
 *
 * Structural rather than `PokemonSet` so tests and the server-shared model stay
 * independent — anything carrying the two numbers fits.
 */
export interface SetSizes {
  /**
   * Every card in the set, from `set.total` and NEVER from counting cards.
   * `/api/set-information` pages at 250 with no pagination, so `sv8` indexes
   * 250 of its 252 cards and `me2pt5` 250 of 295 — a counted denominator would
   * quietly mark those complete two cards early.
   */
  total?: number;
  /** The printed denominator, from `set.printedTotal`. */
  printedTotal?: number;
}

export type CompletionTier = "none" | "base" | "master";

export interface SetTiers {
  /**
   * The base denominator, or `undefined` when this set has no separate base
   * tier — because `printedTotal` is missing, because it is not smaller than
   * `total`, or because the self-check found the set has no base cards at all.
   * It can decline; it must never be wrong.
   */
  baseTotal?: number;
  /** Owned CARDS classified as base. Zero whenever `baseTotal` is undefined. */
  baseOwned: number;
  /** From `set.total`. Undefined when the set's size is not known. */
  masterTotal?: number;
  /** Owned cards in the set, all of them — today's numerator, unchanged. */
  masterOwned: number;
  /** 0–1 for a bar's width, clamped at both ends. Never used to decide `tier`. */
  baseRatio?: number;
  masterRatio?: number;
  /** The highest milestone reached. `master` implies base is done too. */
  tier: CompletionTier;
}

/**
 * What is owned in this set, in one of two fidelities.
 *
 * - `Iterable<string>` — the collector number of each owned CARD, one entry per
 *   card. This is the only form that can be partitioned, so it is the only form
 *   that can produce a base tier.
 * - `number` — "I know how many cards, not which ones". Callers that only hold
 *   `ownedCountsBySet` pass this and get today's single-tier behaviour back.
 *   The base tier is declined rather than guessed.
 *
 * Duplicates are counted, deliberately. Collector numbers are NOT unique inside
 * a set: `zsv10pt5-80` carries `number: "60"` and collides with a real card 60,
 * and `cel25c` has four cards numbered `15`. Counting "distinct numbers in
 * 1..N" would therefore under-count a real collection.
 */
export type OwnedInSet = Iterable<string> | number;

export interface SetTiersOptions {
  /**
   * Every collector number the set is known to contain, when the caller has
   * them. Used ONLY to decline a base tier, never to size one.
   *
   * `xyp` and `smp` are entirely alphanumeric, so the classification rule finds
   * zero base cards in them and a base tier there would be permanently 0 / 208.
   * If nothing in the set can be base, there is no base tier.
   */
  setCardNumbers?: Iterable<string>;
}

const NUMERIC = /^\d+$/;

function positive(n: number | undefined): number | undefined {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
}

function clamp01(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.min(1, Math.max(0, ratio));
}

/** Is this collector number inside the printed run? See the rule above. */
export function isBaseNumber(number: string, printedTotal: number): boolean {
  const trimmed = number.trim();
  if (!NUMERIC.test(trimmed)) return false;
  return Number(trimmed) <= printedTotal;
}

/**
 * The base denominator, or `undefined` when the set has only one tier.
 *
 * `printedTotal >= total` covers 67 of 174 sets — no secrets, so base and
 * master are the same achievement and offering two would be noise. Above that,
 * `swshp` (307/304) and `svp` (215/196) print a denominator LARGER than the
 * set: `min` collapses them into the same single-tier case rather than
 * inventing a base tier bigger than the set it is part of.
 */
export function baseSetTotal(set: SetSizes): number | undefined {
  const printedTotal = positive(set.printedTotal);
  if (printedTotal === undefined) return undefined;
  const total = positive(set.total);
  // Size unknown: base is defined by printedTotal alone, so it is still
  // answerable. Measured present on 174/174 sets, so this is a guard, not a path.
  if (total === undefined) return printedTotal;
  if (printedTotal >= total) return undefined;
  return Math.min(printedTotal, total);
}

/**
 * Both completion tiers for one set.
 *
 * **The numerator is PARTITIONED, never clamped.** This is the whole point of
 * the function. Today's numerator counts every owned card in a set, secrets
 * included; pointed at a base denominator it overshoots wildly — Pitch Black
 * with 20 base cards still missing but all 36 secrets held reads 100 owned
 * against a base total of 84, and a `Math.min(1, …)` anywhere near that would
 * report the base set COMPLETE while a fifth of it is missing. So each owned
 * card is classified first, and the only clamp left is a floor at zero, applied
 * after the split. The completion predicate reads the counts directly
 * (`baseTotal > 0 && baseOwned >= baseTotal`) so that no clamp can ever be the
 * thing that triggers a star.
 */
export function setTiers(set: SetSizes, owned: OwnedInSet, options: SetTiersOptions = {}): SetTiers {
  const masterTotal = positive(set.total);
  const printedTotal = positive(set.printedTotal);
  let baseTotal = baseSetTotal(set);

  let masterOwned = 0;
  let baseOwned = 0;

  if (typeof owned === "number") {
    // A bare count cannot be split, so the base tier is declined rather than
    // approximated from a numerator that includes secret rares.
    masterOwned = owned;
    baseTotal = undefined;
  } else {
    for (const number of owned) {
      masterOwned += 1;
      if (printedTotal !== undefined && isBaseNumber(number, printedTotal)) baseOwned += 1;
    }
  }

  // Self-check: a set the rule can find no base card in has no base tier.
  if (baseTotal !== undefined && printedTotal !== undefined && options.setCardNumbers) {
    let seen = 0;
    let anyBase = false;
    for (const number of options.setCardNumbers) {
      seen += 1;
      if (isBaseNumber(number, printedTotal)) {
        anyBase = true;
        break;
      }
    }
    if (seen > 0 && !anyBase) baseTotal = undefined;
  }

  // Declined means declined: reporting a partition for a tier that is not being
  // offered is how a caller ends up drawing one anyway.
  if (baseTotal === undefined) baseOwned = 0;

  // The only clamp, and it is a floor. Applied AFTER the partition, so it can
  // shift a count toward zero and never toward a total.
  baseOwned = Math.max(0, baseOwned);
  masterOwned = Math.max(0, masterOwned);

  const complete = (ownedCount: number, total: number | undefined) =>
    total !== undefined && total > 0 && ownedCount >= total;

  return {
    ...(baseTotal !== undefined ? { baseTotal } : {}),
    baseOwned,
    ...(masterTotal !== undefined ? { masterTotal } : {}),
    masterOwned,
    ...(baseTotal !== undefined ? { baseRatio: clamp01(baseOwned / baseTotal) } : {}),
    ...(masterTotal !== undefined ? { masterRatio: clamp01(masterOwned / masterTotal) } : {}),
    tier: complete(masterOwned, masterTotal) ? "master" : complete(baseOwned, baseTotal) ? "base" : "none",
  };
}

/**
 * A 0-100 percentage that FLOORS.
 *
 * Rounding is what let 99.7% render as "100%" beside a set that was three cards
 * short — the number said finished and the star said otherwise. Only a set that
 * genuinely reaches its total may print 100.
 */
export function completionPercent(ratio: number | undefined): number | undefined {
  if (ratio === undefined || !Number.isFinite(ratio)) return undefined;
  return Math.floor(clamp01(ratio) * 100);
}
