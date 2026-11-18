import { formatUsd } from "../../utils/format.ts";

export interface CostSlot {
  collectorNumber: string;
  finish: string;
  held: boolean;
  excluded: boolean;
}

export interface CostToFinish {
  /** Printings still wanted: not held and not excluded. */
  missing: number;
  /** How many of those have a market price. */
  priced: number;
  /** Sum of the priced ones only, rounded to cents. */
  total: number;
}

/**
 * What it would cost to finish what is on screen.
 *
 * Unpriced printings are counted in `missing` but add nothing to `total`: a
 * guess would be an invented number, and `priced` is what lets the line say
 * how much of the total is real.
 */
export function costToFinish(
  slots: readonly CostSlot[],
  priceFor: (collectorNumber: string, finish: string) => number | undefined,
): CostToFinish {
  let missing = 0;
  let priced = 0;
  let sum = 0;
  for (const slot of slots) {
    if (slot.held || slot.excluded) continue;
    missing += 1;
    const price = priceFor(slot.collectorNumber, slot.finish);
    if (typeof price === "number" && Number.isFinite(price) && price > 0) {
      priced += 1;
      sum += price;
    }
  }
  return { missing, priced, total: Math.round(sum * 100) / 100 };
}

/** The one-line summary, or null when there is nothing left to buy. */
export function costToFinishLabel({ missing, priced, total }: CostToFinish): string | null {
  if (missing === 0) return null;
  const head = `To finish: ${missing} ${missing === 1 ? "printing" : "printings"} missing`;
  if (priced === 0) return `${head}, none priced`;
  return `${head}, ${priced} priced, about ${formatUsd(total)}`;
}
