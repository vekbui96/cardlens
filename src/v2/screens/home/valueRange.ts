import { VALUE_RANGES, type ValueRange } from "../../../models/valueHistory.ts";

/** Device-local only: never synced, not a cache (no version bump). */
export const VALUE_RANGE_KEY = "cardlens:v1:value-range";

export const DEFAULT_VALUE_RANGE: ValueRange = "30d";

/** Absent, unknown or unreadable all mean the default. */
export function readValueRange(): ValueRange {
  try {
    const raw = window.localStorage.getItem(VALUE_RANGE_KEY);
    return VALUE_RANGES.find((r) => r.key === raw)?.key ?? DEFAULT_VALUE_RANGE;
  } catch {
    return DEFAULT_VALUE_RANGE;
  }
}

/** The default is the absent state, so only the other ranges are ever written. */
export function storeValueRange(value: ValueRange): void {
  try {
    if (value === DEFAULT_VALUE_RANGE) window.localStorage.removeItem(VALUE_RANGE_KEY);
    else window.localStorage.setItem(VALUE_RANGE_KEY, value);
  } catch {
    // Refused storage: the choice lasts for this page only.
  }
}
