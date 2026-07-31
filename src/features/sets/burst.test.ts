import { describe, expect, it } from "vitest";

/**
 * The burst rule, extracted so it can be tested without a DOM.
 *
 * It lives on the screen rather than in the input adapter: the adapter cannot
 * see what is focused, so it had to reset on every other event to avoid firing
 * during rapid marking — which meant one incidental swipe between pinches
 * silently killed the gesture on real hardware.
 */
const BURST_WINDOW_MS = 1200;
const BURST_COUNT = 3;

interface Burst {
  cardId: string;
  at: number;
  count: number;
}

function note(previous: Burst | null, cardId: string, now: number): { burst: Burst; fires: boolean } {
  const sameBurst = previous && previous.cardId === cardId && now - previous.at <= BURST_WINDOW_MS;
  const burst = sameBurst
    ? { ...previous, at: now, count: previous.count + 1 }
    : { cardId, at: now, count: 1 };
  return { burst, fires: burst.count >= BURST_COUNT };
}

function run(steps: { card: string; at: number }[]): boolean[] {
  let burst: Burst | null = null;
  return steps.map((s) => {
    const r = note(burst, s.card, s.at);
    burst = r.fires ? null : r.burst;
    return r.fires;
  });
}

describe("triple-pinch burst", () => {
  it("fires on the third pinch of one card", () => {
    expect(
      run([
        { card: "a", at: 0 },
        { card: "a", at: 300 },
        { card: "a", at: 600 },
      ]),
    ).toEqual([false, false, true]);
  });

  it("tolerates a slow, deliberate triple", () => {
    // A neural-band pinch is nowhere near mouse speed; 500ms between pinches
    // was too strict and made the gesture feel broken.
    expect(
      run([
        { card: "a", at: 0 },
        { card: "a", at: 1000 },
        { card: "a", at: 2000 },
      ]),
    ).toEqual([false, false, true]);
  });

  it("never fires while marking different cards quickly", () => {
    expect(
      run([
        { card: "a", at: 0 },
        { card: "b", at: 100 },
        { card: "c", at: 200 },
        { card: "d", at: 300 },
      ]),
    ).toEqual([false, false, false, false]);
  });

  it("resets when focus moves away and back", () => {
    expect(
      run([
        { card: "a", at: 0 },
        { card: "a", at: 100 },
        { card: "b", at: 200 },
        { card: "a", at: 300 },
      ]),
    ).toEqual([false, false, false, false]);
  });

  it("does not fire on pinches spread beyond the window", () => {
    expect(
      run([
        { card: "a", at: 0 },
        { card: "a", at: 2000 },
        { card: "a", at: 4000 },
      ]),
    ).toEqual([false, false, false]);
  });

  it("needs three fresh pinches again after firing", () => {
    expect(
      run([
        { card: "a", at: 0 },
        { card: "a", at: 200 },
        { card: "a", at: 400 },
        { card: "a", at: 600 },
        { card: "a", at: 800 },
        { card: "a", at: 1000 },
      ]),
    ).toEqual([false, false, true, false, false, true]);
  });
});
