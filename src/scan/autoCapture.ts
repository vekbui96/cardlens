import { hamming } from "./phash.ts";

/**
 * When to fire the shutter without being asked.
 *
 * The goal is a supermarket self-checkout: hold a card up, hear a beep, reach
 * for the next one. Everything here exists to stop the two ways that fails —
 * firing at a card still moving into place, and firing forty times at a card
 * that is simply sitting there.
 *
 * Decisions are made from the perceptual hash that recognition already
 * computes, so the loop costs one hash per tick and nothing else. The same
 * number answers both questions: "has the picture stopped changing" and "is
 * this the card I just scanned".
 */

/** Bits of hash drift still counted as "not moving". Camera noise alone is 1-3. */
export const STABLE_BITS = 4;
/** Consecutive stable ticks required. At ~10fps this is roughly a third of a second. */
export const STABLE_TICKS = 3;
/** Quiet period after a capture, so one card cannot fire twice. */
export const LOCKOUT_MS = 700;
export interface AutoState {
  lastHash: Uint32Array | null;
  stableTicks: number;
  lockedUntil: number;
  /**
   * Whether a capture is allowed at all.
   *
   * Cleared by every capture and restored only when the picture CHANGES. A card
   * left lying under the camera is perfectly stable forever, so a rule based on
   * time alone re-fires the moment its memory expires — measured, that turned
   * one card into a scan every few seconds. Requiring the scene to change means
   * the card has to physically leave before the next one counts, which is also
   * exactly what happens when someone reaches for the next card.
   */
  armed: boolean;
}

export const initialAutoState: AutoState = {
  lastHash: null,
  stableTicks: 0,
  lockedUntil: 0,
  armed: true,
};

export interface Decision {
  capture: boolean;
  state: AutoState;
  /** Why nothing happened, for the on-screen hint. */
  reason: "moving" | "locked" | "held" | "ready";
}

/**
 * Decide whether this frame should be captured.
 *
 * Pure: the caller supplies the clock. Everything about this is timing, and
 * timing that can only be tested by waiting is timing that does not get tested.
 */
export function decide(state: AutoState, hash: Uint32Array, now: number): Decision {
  const drift = state.lastHash ? hamming(hash, 0, state.lastHash, 0) : Number.MAX_SAFE_INTEGER;
  const moved = drift > STABLE_BITS;
  const stableTicks = moved ? 0 : state.stableTicks + 1;
  // Movement is what re-arms. Nothing else does, so a motionless card can never
  // be captured twice however long it stays.
  const armed = state.armed || moved;
  const base: AutoState = { lastHash: hash, stableTicks, lockedUntil: state.lockedUntil, armed };

  // Still moving, or only just arrived — the first frame has nothing to compare
  // against and can only establish the baseline.
  if (stableTicks < STABLE_TICKS) return { capture: false, state: base, reason: "moving" };
  if (now < state.lockedUntil) return { capture: false, state: base, reason: "locked" };
  if (!armed) return { capture: false, state: base, reason: "held" };

  return {
    capture: true,
    reason: "ready",
    state: {
      lastHash: hash,
      // The next card earns its own stability from scratch.
      stableTicks: 0,
      lockedUntil: now + LOCKOUT_MS,
      armed: false,
    },
  };
}

/** What to tell the user while nothing is being captured. */
export function autoHint(reason: Decision["reason"]): string {
  switch (reason) {
    case "moving":
      return "Hold still…";
    case "locked":
      return "Next card";
    case "held":
      return "Scanned — swap the card";
    default:
      return "Scanning";
  }
}
