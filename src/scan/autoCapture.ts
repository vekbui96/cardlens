import { hamming } from "./phash.ts";

/**
 * When to fire the shutter without being asked.
 *
 * The goal is a supermarket self-checkout: hold a card up, hear a beep, reach
 * for the next one. Everything here exists to stop the three ways that fails —
 * firing at a card still moving into place, firing forty times at a card that is
 * simply sitting there, and firing at the empty mat between two cards.
 *
 * Decisions are made from the perceptual hash that recognition already computes
 * plus one number derived from the same downscale, so the loop still costs one
 * pass over the frame.
 */

/** Bits of hash drift still counted as "not moving". Camera noise alone is 1-3. */
export const STABLE_BITS = 4;
/** Consecutive stable ticks required. At ~10fps this is roughly a third of a second. */
export const STABLE_TICKS = 3;
/** Quiet period after a capture, so one card cannot fire twice. */
export const LOCKOUT_MS = 700;

/**
 * Greyscale standard deviation below which the guide is treated as empty.
 *
 * MEASURED — `node scripts/measure-detail.mjs me5 me3 me2 rsv10pt5 sv8` over 160
 * real cards against synthetic empty frames:
 *
 * ```
 * card art       min 22.4   p5 29.2   median 42.3   max 62.8
 * flat mat        0.3
 * woodgrain       4.5
 * lit desk        11.3
 * a hand          11.4
 * ```
 *
 * 16 sits clear of both ends — 1.4x above the busiest thing that is not a card
 * and 1.4x below the quietest thing that is. The failure it prevents used to be
 * unavoidable: lifting a card off the mat is a CHANGE, the bare mat then holds
 * perfectly still, and the old rule read that as a new subject and photographed
 * it. Every pair of cards produced a "No match found" row in between.
 *
 * Erring low is deliberate. A missed capture costs a button press; a false one
 * costs a row someone has to read and reject.
 */
export const MIN_DETAIL = 16;

/**
 * Bits of difference from the last CAPTURED frame before a subject counts as new.
 *
 * Distinct cards sit ~20 bits apart; the same card re-settling after a hand
 * passes over it drifts under 8. 12 is the gap between those, and it is what
 * stops the most common duplicate: reaching in to straighten a card, which used
 * to re-arm the shutter and scan it a second time.
 *
 * Two IDENTICAL cards in a row are not caught by this and must not be — see
 * `sawSomethingElse`.
 */
export const NEW_SUBJECT_BITS = 12;

export interface AutoState {
  lastHash: Uint32Array | null;
  stableTicks: number;
  lockedUntil: number;
  /** What was last captured, so "is this still that" can be asked directly. */
  capturedHash: Uint32Array | null;
  /**
   * Whether the guide has held something else since the last capture.
   *
   * This is what makes a duplicate card scannable. Comparing against
   * `capturedHash` alone would refuse the second of two identical cards forever,
   * which is exactly what someone digitising four copies of a staple is doing.
   * An emptied guide — or any other stable subject — clears the memory, and
   * that is precisely the physical act of taking one card away before laying
   * down the next.
   */
  sawSomethingElse: boolean;
}

export const initialAutoState: AutoState = {
  lastHash: null,
  stableTicks: 0,
  lockedUntil: 0,
  capturedHash: null,
  sawSomethingElse: true,
};

export interface Decision {
  capture: boolean;
  state: AutoState;
  /** Why nothing happened, for the on-screen hint. */
  reason: "moving" | "locked" | "empty" | "held" | "ready";
}

/**
 * Decide whether this frame should be captured.
 *
 * Pure: the caller supplies the clock. Everything about this is timing, and
 * timing that can only be tested by waiting is timing that does not get tested.
 *
 * `detail` is the greyscale spread of the same region the hash covers — see
 * `phash.detail`. It is a separate argument rather than derived here so this
 * stays pure and the caller keeps paying for exactly one pass over the frame.
 */
export function decide(state: AutoState, hash: Uint32Array, detail: number, now: number): Decision {
  const drift = state.lastHash ? hamming(hash, 0, state.lastHash, 0) : Number.MAX_SAFE_INTEGER;
  const moved = drift > STABLE_BITS;
  const stableTicks = moved ? 0 : state.stableTicks + 1;
  const settled = stableTicks >= STABLE_TICKS;
  const occupied = detail >= MIN_DETAIL;

  // Is this still the thing that was just photographed?
  const isNewSubject = !state.capturedHash || hamming(hash, 0, state.capturedHash, 0) >= NEW_SUBJECT_BITS;

  // Only a SETTLED subject clears the memory, so a hand sweeping past on its way
  // somewhere else does not count as having swapped the card. An empty guide
  // does count, which is the whole point — it is what standing between two
  // copies of the same card looks like.
  const sawSomethingElse = state.sawSomethingElse || (settled && isNewSubject);

  const base: AutoState = {
    lastHash: hash,
    stableTicks,
    lockedUntil: state.lockedUntil,
    capturedHash: state.capturedHash,
    sawSomethingElse,
  };

  // Still moving, or only just arrived — the first frame has nothing to compare
  // against and can only establish the baseline.
  if (!settled) return { capture: false, state: base, reason: "moving" };
  if (now < state.lockedUntil) return { capture: false, state: base, reason: "locked" };
  // Ordered before the duplicate check on purpose: an empty guide is a state the
  // user can fix by putting a card down, and saying so beats "scanned already".
  if (!occupied) return { capture: false, state: base, reason: "empty" };
  if (!isNewSubject && !sawSomethingElse) return { capture: false, state: base, reason: "held" };

  return {
    capture: true,
    reason: "ready",
    state: {
      lastHash: hash,
      // The next card earns its own stability from scratch.
      stableTicks: 0,
      lockedUntil: now + LOCKOUT_MS,
      capturedHash: hash,
      sawSomethingElse: false,
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
    case "empty":
      return "Show a card";
    case "held":
      return "Scanned — swap the card";
    default:
      return "Scanning";
  }
}
