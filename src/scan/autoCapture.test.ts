import { describe, expect, it } from "vitest";
import {
  LOCKOUT_MS,
  STABLE_TICKS,
  autoHint,
  decide,
  initialAutoState,
  type AutoState,
} from "./autoCapture.ts";

/** A hash differing from `base` by `bits` low bits. */
const hash = (bits = 0) => new Uint32Array([(1 << bits) - 1, 0]);

/** Feed the same frame repeatedly, returning every decision. */
function feed(state: AutoState, h: Uint32Array, times: number, at = 0, step = 100) {
  const decisions = [];
  let current = state;
  for (let i = 0; i < times; i++) {
    const d = decide(current, h, at + i * step);
    current = d.state;
    decisions.push(d);
  }
  return { decisions, state: current };
}

describe("auto capture", () => {
  it("waits for the picture to settle before firing", () => {
    // The card is still moving into the frame. Capturing here photographs a
    // card halfway into shot, which is the main way auto-capture feels broken.
    let state = initialAutoState;
    for (const h of [hash(2), hash(20), hash(9)]) {
      const d = decide(state, h, 0);
      state = d.state;
      expect(d.capture).toBe(false);
      expect(d.reason).toBe("moving");
    }
  });

  it("fires once the frame holds still", () => {
    // STABLE_TICKS + 1 frames: the first has nothing to compare against and
    // only establishes the baseline, so it can never count as stable.
    const { decisions } = feed(initialAutoState, hash(8), STABLE_TICKS + 1);
    expect(decisions.slice(0, STABLE_TICKS).every((d) => !d.capture)).toBe(true);
    expect(decisions.at(-1)?.capture).toBe(true);
  });

  it("tolerates camera noise, which is never pixel-identical", () => {
    let state = decide(initialAutoState, new Uint32Array([0b1111, 0]), 0).state;
    // One bit of drift per frame — a hand holding a card, not a new card.
    state = decide(state, new Uint32Array([0b1110, 0]), 100).state;
    state = decide(state, new Uint32Array([0b1111, 0]), 200).state;
    expect(decide(state, new Uint32Array([0b1110, 0]), 300).capture).toBe(true);
  });

  it("does not scan the same card forty times while it sits there", () => {
    // The single most important rule: a stable card stays stable forever.
    const first = feed(initialAutoState, hash(8), STABLE_TICKS + 1);
    expect(first.decisions.at(-1)?.capture).toBe(true);

    // Forty ticks — four seconds of a card simply lying there.
    const after = feed(first.state, hash(8), 40, (STABLE_TICKS + 1) * 100 + LOCKOUT_MS + 100);
    expect(after.decisions.some((d) => d.capture)).toBe(false);
    expect(after.decisions.at(-1)?.reason).toBe("held");
  });

  it("holds off briefly even for a genuinely different card", () => {
    const first = feed(initialAutoState, hash(8), STABLE_TICKS + 1);
    // A new card, stable immediately, but inside the lockout.
    const d = feed(first.state, hash(24), STABLE_TICKS + 1, 10);
    expect(d.decisions.some((x) => x.capture)).toBe(false);
    expect(d.decisions.at(-1)?.reason).toBe("locked");
  });

  it("captures the next card once the lockout passes", () => {
    const first = feed(initialAutoState, hash(8), STABLE_TICKS + 1);
    const next = feed(first.state, hash(28), STABLE_TICKS + 1, LOCKOUT_MS + 100);
    expect(next.decisions.at(-1)?.capture).toBe(true);
  });

  it("scans a second identical card once the first is taken away", () => {
    // Four identical energies in a row is a real thing people scan, and the
    // difference from a card left lying there is that the frame changes in
    // between.
    const first = feed(initialAutoState, hash(8), STABLE_TICKS + 1);
    const emptied = decide(first.state, hash(30), 1000).state; // hand reaches in
    const second = feed(emptied, hash(8), STABLE_TICKS + 1, 1500);
    expect(second.decisions.at(-1)?.capture).toBe(true);
  });

  it("says why it is waiting", () => {
    expect(autoHint("moving")).toMatch(/still/i);
    expect(autoHint("held")).toMatch(/swap/i);
    expect(autoHint("locked")).toBeTruthy();
  });
});
