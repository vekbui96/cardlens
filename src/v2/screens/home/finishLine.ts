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
export function homeFinishLine(input: FinishInput): string | null {
  return finishLineText(homeFinishParts(input));
}

export function finishLineText(parts: FinishParts | null): string | null {
  if (!parts) return null;
  const { toGo, priced, total } = parts;
  const head = cardsToGo(toGo);
  if (priced === null) return head;
  if (priced === 0) return `${head}, none priced`;
  const unpriced = Math.max(0, toGo - priced);
  return `${head}, about ${formatUsd(total)}${unpriced > 0 ? `, ${unpriced} unpriced` : ""}`;
}

interface FinishInput {
  cards: number;
  total: number;
  /** Collector numbers held, or null when they do not add up to `cards`. */
  ownedNumbers: readonly string[] | null;
  byNumber: Record<string, Printing[]> | null;
}

/** What a row still needs, as numbers: the parts `homeFinishLine` words and `sumFinishLines` adds. */
export interface FinishParts {
  toGo: number;
  /** Missing cards with a price, or null when the price is unknown (count alone). */
  priced: number | null;
  /** Sum of the priced ones only. */
  total: number;
}

const cardsToGo = (n: number): string => `${n} ${n === 1 ? "card to go" : "cards to go"}`;

/**
 * One line for the sets listed: the same parts added up. A row whose price is
 * unknown makes the whole line count-only, and unpriced cards are always stated,
 * so the sum never reads as covering more than it does. Nothing for fewer than
 * two sets: the row already says it.
 */
export function sumFinishLines(parts: readonly (FinishParts | null | undefined)[]): string | null {
  const rows = parts.filter((p): p is FinishParts => !!p && p.toGo > 0);
  if (rows.length < 2) return null;
  const toGo = rows.reduce((n, p) => n + p.toGo, 0);
  const head = `To finish these ${rows.length} sets: ${cardsToGo(toGo)}`;
  if (rows.some((p) => p.priced === null)) return head;
  const priced = rows.reduce((n, p) => n + (p.priced ?? 0), 0);
  if (priced === 0) return `${head}, none priced`;
  const total = Math.round(rows.reduce((n, p) => n + p.total, 0) * 100) / 100;
  const unpriced = toGo - priced;
  return `${head}, about ${formatUsd(total)}${unpriced > 0 ? ` (${unpriced} unpriced)` : ""}`;
}

export function homeFinishParts({ cards, total, ownedNumbers, byNumber }: FinishInput): FinishParts | null {
  const toGo = Math.max(0, total - cards);
  if (toGo === 0) return null;

  const index = buildPrintingIndex(byNumber);
  if (!index || !ownedNumbers) return { toGo, priced: null, total: 0 };

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
  return { toGo, priced: cost.priced, total: cost.total };
}
