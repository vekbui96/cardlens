import type { Printing } from "../../../integrations/tcgdex/client.ts";
import { makeFinish } from "../../../models/finishes.ts";
import { buildPrintingIndex, printingPrice } from "../../../models/printingIndex.ts";
import { costToFinish } from "../../../web/sets/costToFinish.ts";

const unpadded = (n: string): string => n.replace(/^0+(?=\d)/, "");

/** One owned set: the collector numbers held (any finish) and its cached printings. */
export interface WantSetInput {
  setId: string;
  ownedNumbers: readonly string[];
  /** Printings by collector number, or null when the device has not cached them. */
  byNumber: Record<string, Printing[]> | null;
}

/** A card not owned in any finish, at its cheapest priced printing (USD). */
export interface WantCard {
  collectorNumber: string;
  finish: string;
  /** USD market price, or null when none is known (never guessed). */
  price: number | null;
}

export interface WantSet {
  setId: string;
  cards: WantCard[];
  missing: number;
  priced: number;
  unpriced: number;
  /** Sum of the priced ones only, rounded to cents. */
  total: number;
}

export interface WantList {
  /** Owned sets that still have missing cards, in input order. */
  sets: WantSet[];
  missing: number;
  priced: number;
  unpriced: number;
  total: number;
  /** Owned sets whose printings are not cached: counted nowhere, not guessed. */
  unknownSets: string[];
}

/**
 * What it would take to finish every set the collector has started.
 *
 * A set counts only when at least one of its numbers is owned; "missing" means
 * not owned in any finish. Pricing follows the Home finishing line: each missing
 * card at its cheapest priced printing, USD only, unpriced cards counted but
 * adding nothing to the total. Pure derivation; nothing is stored.
 */
export function buildWantList(inputs: readonly WantSetInput[]): WantList {
  const sets: WantSet[] = [];
  const unknownSets: string[] = [];
  let missing = 0;
  let priced = 0;
  let sum = 0;

  for (const { setId, ownedNumbers, byNumber } of inputs) {
    if (ownedNumbers.length === 0) continue;
    const index = buildPrintingIndex(byNumber);
    if (!index || !byNumber) {
      unknownSets.push(setId);
      continue;
    }

    const owned = new Set(ownedNumbers.map(unpadded));
    const seen = new Set<string>();
    const cards: WantCard[] = [];
    const slots: { collectorNumber: string; finish: string; held: boolean; excluded: boolean }[] = [];
    for (const [number, printings] of Object.entries(byNumber)) {
      const key = unpadded(number);
      if (seen.has(key) || owned.has(key)) continue;
      seen.add(key);
      let pick: string | undefined;
      let best: number | undefined;
      for (const finish of printings.map((p) => makeFinish(p.type, p.foil))) {
        pick ??= finish;
        const price = printingPrice(index, number, finish);
        if (price !== undefined && (best === undefined || price < best)) {
          best = price;
          pick = finish;
        }
      }
      if (pick === undefined) continue;
      cards.push({ collectorNumber: number, finish: pick, price: best ?? null });
      slots.push({ collectorNumber: number, finish: pick, held: false, excluded: false });
    }
    if (cards.length === 0) continue;

    const cost = costToFinish(slots, (n, f) => printingPrice(index, n, f));
    sets.push({
      setId,
      cards,
      missing: cost.missing,
      priced: cost.priced,
      unpriced: cost.missing - cost.priced,
      total: cost.total,
    });
    missing += cost.missing;
    priced += cost.priced;
    sum += cost.total;
  }

  return {
    sets,
    missing,
    priced,
    unpriced: missing - priced,
    total: Math.round(sum * 100) / 100,
    unknownSets,
  };
}
