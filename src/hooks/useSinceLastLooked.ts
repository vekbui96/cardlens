import { useEffect, useRef, useState } from "react";
import { compareLook, recordLook, type SinceLastLooked } from "../models/lastLook.ts";
import { readLastLook, writeLastLook } from "../storage/lastLook.ts";
import type { VersionedStore } from "../storage/versioned.ts";

/** Home's total is TCGplayer market USD (see models/value.ts). */
const TOTAL_CURRENCY = "USD";

export interface LookInput {
  total: number;
  cards: number;
  priced: number;
  printings: number;
  /** Pricing still in flight. Nothing is read or written until it is zero. */
  pending: number;
}

/**
 * Compare this visit with the previous one on this device, once prices settle.
 *
 * Once per mount, and never mid-load: a snapshot taken while sets are still
 * pricing would make the next visit report a rise that is only the catalog
 * catching up. No request is made; it is one localStorage read and one write.
 * Any storage failure returns null and leaves Home as it was.
 */
export function useSinceLastLooked(input: LookInput, store?: VersionedStore): SinceLastLooked | null {
  const [result, setResult] = useState<SinceLastLooked | null>(null);
  const done = useRef(false);
  const { total, cards, priced, printings, pending } = input;

  useEffect(() => {
    if (done.current || pending > 0 || printings === 0) return;
    done.current = true;
    try {
      const now = Date.now();
      const current = { at: now, total, cards, priced, printings, currency: TOTAL_CURRENCY };
      const { baseline, next } = recordLook(readLastLook(store), current, now);
      writeLastLook(next, store);
      setResult(compareLook(baseline, current, now));
    } catch {
      setResult(null);
    }
  }, [total, cards, priced, printings, pending, store]);

  return result;
}
