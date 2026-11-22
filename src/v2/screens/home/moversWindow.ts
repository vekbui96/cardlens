import type { MoverWindow } from "../../../models/movement.ts";

/** Device-local only: never synced, not a cache (no version bump). */
export const MOVERS_WINDOW_KEY = "cardlens:v1:movers-window";

/** Absent and 7 are the same state, so only 30 is ever written. */
export function readMoversWindow(): MoverWindow {
  try {
    return window.localStorage.getItem(MOVERS_WINDOW_KEY) === "30" ? 30 : 7;
  } catch {
    return 7;
  }
}

export function storeMoversWindow(value: MoverWindow): void {
  try {
    if (value === 7) window.localStorage.removeItem(MOVERS_WINDOW_KEY);
    else window.localStorage.setItem(MOVERS_WINDOW_KEY, "30");
  } catch {
    // Refused storage: the choice lasts for this page only.
  }
}
