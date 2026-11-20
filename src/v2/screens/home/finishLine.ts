import type { Printing } from "../../../integrations/tcgdex/client.ts";
import { makeFinish } from "../../../models/finishes.ts";
import { buildPrintingIndex, printingPrice } from "../../../models/printingIndex.ts";
import { costToFinish } from "../../../web/sets/costToFinish.ts";
import { formatUsd } from "../../../utils/format.ts";

const unpadded = (n: string): string => n.replace(/^0+(?=\d)/, "");

/**
 * What a "Closest to complete" row still needs, as one line.
 *
 * The count always comes from the set size the row already shows. The price
 * comes only from printings the device already holds (`byNumber`, a cache read):
 * when they are not there the line is the count alone, never a guess. A missing
 * card is priced at its cheapest priced printing, since finishing a set means
 * one copy of each card, and `costToFinish` leaves unpriced ones out of the sum.
 */
export function homeFinishLine({
  cards,
  total,
  ownedNumbers,
  byNumber,
}: {
  cards: number;
  total: number;
  /** Collector numbers held, or null when they do not add up to `cards`. */
  ownedNumbers: readonly string[] | null;
  byNumber: Record<string, Printing[]> | null;
}): string | null {
  const toGo = Math.max(0, total - cards);
  if (toGo === 0) return null;
  const head = `${toGo} ${toGo === 1 ? "card to go" : "cards to go"}`;

  const index = buildPrintingIndex(byNumber);
  if (!index || !ownedNumbers) return head;

  const owned = new Set(ownedNumbers.map(unpadded));
  const seen = new Set<string>();
  const slots: { collectorNumber: string; finish: string; held: boolean; excluded: boolean }[] = [];
  for (const [number, printings] of Object.entries(byNumber ?? {})) {
    const key = unpadded(number);
    if (seen.has(key) || owned.has(key)) continue;
    seen.add(key);
    const finishes = printings.map((p) => makeFinish(p.type, p.foil));
    let pick = finishes[0];
    let best: number | undefined;
    for (const finish of finishes) {
      const price = printingPrice(index, number, finish);
      if (price !== undefined && (best === undefined || price < best)) {
        best = price;
        pick = finish;
      }
    }
    if (pick === undefined) continue;
    slots.push({ collectorNumber: number, finish: pick, held: false, excluded: false });
  }

  const cost = costToFinish(slots, (n, f) => printingPrice(index, n, f));
  if (cost.priced === 0) return `${head}, none priced`;
  const unpriced = Math.max(0, toGo - cost.priced);
  return `${head}, about ${formatUsd(cost.total)}${unpriced > 0 ? `, ${unpriced} unpriced` : ""}`;
}
