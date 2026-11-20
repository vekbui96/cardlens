import { finishLabel } from "../../models/finishes.ts";
import { formatUsd } from "../../utils/format.ts";

export interface MissingListSlot {
  collectorNumber: string;
  finish: string;
  held: boolean;
  excluded: boolean;
  card: { name: string };
}

/**
 * The set's want list as plain text, for pasting into a chat.
 *
 * Same rule as `costToFinish`: a printing is missing when it is neither held nor
 * excluded, so an excluded one is never listed and not part of the "of N" total.
 * An unpriced printing says so rather than showing a made-up number.
 */
export function missingListText(
  slots: readonly MissingListSlot[],
  priceFor: (collectorNumber: string, finish: string) => number | undefined,
  setName: string,
): { text: string; count: number } {
  const wanted = slots.filter((s) => !s.excluded);
  const missing = wanted.filter((s) => !s.held);
  if (missing.length === 0) return { text: "", count: 0 };
  const lines = missing.map((s) => {
    const price = priceFor(s.collectorNumber, s.finish);
    const priced = typeof price === "number" && Number.isFinite(price) && price > 0;
    const finish = s.finish === "normal" ? "" : ` (${finishLabel(s.finish)})`;
    return `${s.card.name} #${s.collectorNumber}${finish} - ${priced ? formatUsd(price) : "unpriced"}`;
  });
  return {
    text: [`${setName}: missing ${missing.length} of ${wanted.length}`, ...lines].join("\n"),
    count: missing.length,
  };
}
