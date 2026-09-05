import type { CardVariants } from "../../../models/cards.ts";
import { knownFinishes } from "../../../models/cards.ts";
import { compareFinishes, type Finish } from "../../../models/finishes.ts";
import type { SetPrintingIndex } from "../../../models/printingIndex.ts";

/**
 * Which printings a card exists in, and how sure we are.
 *
 * Two oracles, in order:
 *
 * 1. **TCGdex printings** for the set. The real list — it knows Poké Ball and
 *    Master Ball reverses, which pricing data has never reported for any set.
 * 2. **What the pricing payload implies.** A weak signal: pokemontcg.io reports
 *    no variant data at all for some sets (0/120 Pitch Black), so this is a
 *    fallback, not a substitute.
 *
 * `knownFinishes` rather than `availableFinishes` on the second path, because
 * this list is what a mark WRITES. `availableFinishes` pads to `normal` so a row
 * always has something to draw, and marking against that padding is what wrote
 * `normal` onto holo-only cards in a live collection. When nothing vouches for
 * the card, the honest answer is an empty list and a note saying so.
 */

export type PrintingSource =
  /** From the set's TCGdex printings — the real list. */
  | "printings"
  /** Implied by the pricing payload — everything patterned is missing. */
  | "pricing"
  /** Nothing vouches for this card's printings. Offer none rather than guess. */
  | "unknown";

export interface PrintingList {
  finishes: Finish[];
  source: PrintingSource;
}

/**
 * TCGdex pads modern collector numbers and pokemontcg.io does not, and either
 * form can reach here — "007" and "7" are the same card. Same three forms
 * `printingPrice` tries, for the same reason.
 */
function numberForms(collectorNumber: string): string[] {
  return [collectorNumber, collectorNumber.replace(/^0+(?=\d)/, ""), collectorNumber.padStart(3, "0")];
}

export function printingsOf(
  index: SetPrintingIndex | null | undefined,
  collectorNumber: string,
  variants?: CardVariants,
): PrintingList {
  if (index && collectorNumber) {
    for (const form of numberForms(collectorNumber)) {
      const found = index.byNumber[form];
      if (found && found.length > 0) {
        return { finishes: [...found].sort(compareFinishes), source: "printings" };
      }
    }
  }

  const implied = knownFinishes(variants);
  if (implied && implied.length > 0) {
    return { finishes: [...implied].sort(compareFinishes), source: "pricing" };
  }

  return { finishes: [], source: "unknown" };
}
