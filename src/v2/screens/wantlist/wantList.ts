import { printingPrice, type SetPrintingIndex } from "../../../models/printingIndex.ts";
import { costToFinish } from "../../../web/sets/costToFinish.ts";
import { formatUsd } from "../../../utils/format.ts";

const unpadded = (n: string): string => n.replace(/^0+(?=\d)/, "");

/** A card not owned in any finish, at its cheapest priced printing (USD). */
export interface WantCard {
  collectorNumber: string;
  finish: string;
  /** USD market price, or null when none is known (never guessed). */
  price: number | null;
  /** Filled in by the screen from the catalog card, when it knows it. */
  rarity?: string;
  /** Likewise: the catalog card's name, for the copied list. */
  name?: string;
}

/** What one started set still needs. */
export interface WantSet {
  cards: WantCard[];
  missing: number;
  priced: number;
  unpriced: number;
  /** Sum of the priced ones only, rounded to cents. */
  total: number;
}

export interface WantTotals {
  /** Sets with at least one missing card. */
  sets: number;
  missing: number;
  priced: number;
  unpriced: number;
  total: number;
}

/**
 * What one started set still needs, from the printing index the Set screen
 * loads (`useSetView`), so the two can never disagree.
 *
 * "Missing" means not owned in any finish. Pricing follows Home's finishing
 * line (`homeFinishParts`): each missing card at its cheapest priced printing,
 * USD only, unpriced cards counted but adding nothing. Returns null when the
 * printings are not known: a set is never guessed at. Pure; nothing is stored.
 */
export function wantForSet(ownedNumbers: readonly string[], index: SetPrintingIndex | null): WantSet | null {
  if (!index) return null;
  const owned = new Set(ownedNumbers.map(unpadded));
  const seen = new Set<string>();
  const cards: WantCard[] = [];
  for (const [number, finishes] of Object.entries(index.byNumber)) {
    const key = unpadded(number);
    if (seen.has(key) || owned.has(key)) continue;
    seen.add(key);
    let pick: string | undefined;
    let best: number | undefined;
    for (const finish of finishes) {
      pick ??= finish;
      const price = printingPrice(index, number, finish);
      if (price !== undefined && (best === undefined || price < best)) {
        best = price;
        pick = finish;
      }
    }
    if (pick === undefined) continue;
    cards.push({ collectorNumber: number, finish: pick, price: best ?? null });
  }

  const cost = costToFinish(
    cards.map((c) => ({
      collectorNumber: c.collectorNumber,
      finish: c.finish,
      held: false,
      excluded: false,
    })),
    (n, f) => printingPrice(index, n, f),
  );
  return {
    cards,
    missing: cost.missing,
    priced: cost.priced,
    unpriced: cost.missing - cost.priced,
    total: cost.total,
  };
}

/** The sets' needs added up; finished sets add nothing and are not counted. */
export function sumWant(sets: readonly (WantSet | null | undefined)[]): WantTotals {
  const open = sets.filter((s): s is WantSet => !!s && s.missing > 0);
  const missing = open.reduce((n, s) => n + s.missing, 0);
  const priced = open.reduce((n, s) => n + s.priced, 0);
  const total = Math.round(open.reduce((n, s) => n + s.total, 0) * 100) / 100;
  return { sets: open.length, missing, priced, unpriced: missing - priced, total };
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "N missing, about $X, N unpriced": the price part of a line, never a guess. */
export function pricePart(priced: number, unpriced: number, total: number): string {
  if (priced === 0) return "none priced";
  return `${priced} priced, about ${formatUsd(total)}${unpriced > 0 ? `, ${unpriced} unpriced` : ""}`;
}

/** The screen's header: "To finish: N cards missing across N sets, N priced, about $X, N unpriced". */
export function wantHeadline(totals: WantTotals): string {
  if (totals.missing === 0) return "Nothing missing in the sets loaded so far";
  return (
    `To finish: ${plural(totals.missing, "card", "cards")} missing across ${plural(totals.sets, "set", "sets")}, ` +
    pricePart(totals.priced, totals.unpriced, totals.total)
  );
}

/** One set's line: "N missing, about $X" (and its unpriced count). */
export function wantSetLine(set: WantSet): string {
  if (set.missing === 0) return "Complete";
  if (set.priced === 0) return `${set.missing} missing, none priced`;
  return `${set.missing} missing, about ${formatUsd(set.total)}${set.unpriced > 0 ? `, ${set.unpriced} unpriced` : ""}`;
}
