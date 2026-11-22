import { costToFinish, costToFinishLabel } from "../../../web/sets/costToFinish.ts";
import type { PrintingSlot } from "./slots.ts";
import styles from "./set.module.css";

/**
 * What finishing the set would cost, under the printings meter.
 *
 * Reuses `costToFinish`, so excluded printings are left out and an unpriced one
 * is counted as unpriced, never given a number. The line keeps its height while
 * the set loads (and when there is nothing to say), so the screen does not shift
 * when prices arrive.
 */
export function FinishLine({
  slots,
  priceFor,
  settled,
}: {
  slots: readonly PrintingSlot[];
  priceFor: (collectorNumber: string, finish: string) => number | undefined;
  settled: boolean;
}) {
  let text = "";
  if (settled && slots.length > 0) {
    text = costToFinishLabel(costToFinish(slots, priceFor)) ?? "Complete";
  }
  return (
    <p className={styles.finishLine} data-testid="finish-line">
      {text}
    </p>
  );
}
