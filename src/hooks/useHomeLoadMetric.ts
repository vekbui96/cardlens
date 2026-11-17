import { useEffect, useRef } from "react";
import { track } from "../services/metrics.ts";

/**
 * Count one settled Home load and its price coverage — the "480 of 973
 * printings priced" figure, as two sums, so the server can report coverage
 * across every load rather than the one Ve happened to look at.
 *
 * Once per mount and only once pricing has settled: a figure taken mid-request
 * would record the half-priced state the screen itself is careful not to call
 * final. An empty collection is not a load worth counting — nothing was priced
 * because nothing was held.
 */
export function useHomeLoadMetric(value: { pending: number; priced: number; printings: number }): void {
  const counted = useRef(false);
  const { pending, priced, printings } = value;
  useEffect(() => {
    if (counted.current || pending > 0 || printings === 0) return;
    counted.current = true;
    track("home.load");
    track("home.priced", priced);
    track("home.printings", printings);
  }, [pending, priced, printings]);
}
