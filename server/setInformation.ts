import type { SetPrintings } from "../src/integrations/tcgdex/client.ts";

/** What `printingsStore.get()` answers, minus the cache flag the body does not need. */
export interface PrintingsAnswer {
  value: SetPrintings | null;
  complete: boolean;
}

/**
 * The `/api/set-information` body.
 *
 * `printingsComplete` is the one thing the combined endpoint used to throw
 * away. `/api/printings` says it through `Cache-Control` (an hour when TCGdex
 * skipped cards, a month otherwise), but this route caches for an hour either
 * way, so the device had no way to tell a half-built set from a whole one and
 * stored both for 30 days. A top-level field leaves the `cards` / `printings`
 * envelope alone: an older client simply ignores it, and a client that finds it
 * missing treats the answer as complete, which is what it always meant.
 *
 * No printings at all is not "complete": there is nothing to keep.
 */
export function setInformationBody(setId: string, cards: unknown, printings: PrintingsAnswer | null) {
  const value = printings?.value ?? null;
  return {
    setId,
    cards,
    printings: value,
    printingsComplete: value !== null && printings !== null && printings.complete,
  };
}
