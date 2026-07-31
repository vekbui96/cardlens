import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { KeyboardBackedInputAdapter, SELECT_BURST_MS, SELECT_HOLD_MS } from "./KeyboardBackedInputAdapter.ts";
import type { WearableInputEvent } from "../../models/input.ts";

function harness() {
  const target = new EventTarget();
  const adapter = new KeyboardBackedInputAdapter(target);
  const events: WearableInputEvent["type"][] = [];
  const stop = adapter.subscribe((e) => events.push(e.type));
  const down = (key: string, repeat = false) =>
    target.dispatchEvent(Object.assign(new Event("keydown"), { key, repeat, preventDefault() {} }));
  const up = (key: string) =>
    target.dispatchEvent(Object.assign(new Event("keyup"), { key, preventDefault() {} }));
  return { events, down, up, stop };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("SELECT hold detection", () => {
  it("fires SELECT on press when the device has never sent a key-up", () => {
    // The documented platform surface is keydown ONLY. If SELECT waited for a
    // key-up that never arrives, the app would be unusable on the glasses.
    const { events, down } = harness();
    down("Enter");
    expect(events).toEqual(["SELECT"]);
  });

  it("keeps working for repeated taps with no key-up at all", () => {
    const { events, down } = harness();
    down("Enter");
    down("ArrowDown");
    down("Enter");
    down("ArrowDown");
    down("Enter");
    expect(events.filter((e) => e === "SELECT")).toHaveLength(3);
  });

  it("does not treat rapid collecting as a burst", () => {
    // pinch-swipe-pinch-swipe-pinch is the normal marking rhythm and must never
    // trigger the bulk action, however fast it is done.
    const { events, down } = harness();
    for (let i = 0; i < 5; i++) {
      down("Enter");
      down("ArrowDown");
    }
    expect(events).not.toContain("SELECT_HOLD");
  });

  it("emits SELECT_HOLD once the press passes the threshold", () => {
    const { events, down } = harness();
    down("Enter");
    vi.advanceTimersByTime(SELECT_HOLD_MS + 10);
    expect(events).toContain("SELECT_HOLD");
    expect(events.filter((e) => e === "SELECT_HOLD")).toHaveLength(1);
  });

  it("does not fire a hold for a quick tap", () => {
    const { events, down, up } = harness();
    down("Enter");
    vi.advanceTimersByTime(50);
    up("Enter");
    vi.advanceTimersByTime(SELECT_HOLD_MS);
    expect(events).not.toContain("SELECT_HOLD");
  });

  it("moves SELECT to release once key-up is proven, without double-firing", () => {
    const { events, down, up } = harness();
    down("Enter");
    up("Enter"); // teaches the adapter that key-up exists
    expect(events).toEqual(["SELECT"]);

    events.length = 0;
    down("Enter");
    expect(events).toEqual([]); // now waits for release
    up("Enter");
    expect(events).toEqual(["SELECT"]);
  });

  it("suppresses the tap when a press became a hold", () => {
    const { events, down, up } = harness();
    down("Enter");
    up("Enter"); // learn key-up
    events.length = 0;

    down("Enter");
    vi.advanceTimersByTime(SELECT_HOLD_MS + 10);
    up("Enter");
    expect(events).toEqual(["SELECT_HOLD"]);
  });

  it("detects a hold from auto-repeat when no key-up arrives", () => {
    const { events, down } = harness();
    down("Enter");
    events.length = 0;
    vi.advanceTimersByTime(SELECT_HOLD_MS + 10);
    down("Enter", true); // repeat while still held
    expect(events.filter((e) => e === "SELECT_HOLD")).toHaveLength(1);
  });

  it("fires the bulk action on a triple pinch", () => {
    // Built only from keydown, which is all the platform docs promise — so this
    // is the bulk gesture that is certain to work on the glasses.
    const { events, down } = harness();
    down("Enter");
    down("Enter");
    down("Enter");
    expect(events.filter((e) => e === "SELECT_HOLD")).toHaveLength(1);
    // The third press does not also count as a tap.
    expect(events.filter((e) => e === "SELECT")).toHaveLength(2);
  });

  it("does not fire on slow repeated pinches", () => {
    const { events, down } = harness();
    down("Enter");
    vi.advanceTimersByTime(SELECT_BURST_MS + 50);
    down("Enter");
    vi.advanceTimersByTime(SELECT_BURST_MS + 50);
    down("Enter");
    expect(events).not.toContain("SELECT_HOLD");
  });

  it("starts a fresh burst after firing", () => {
    const { events, down } = harness();
    for (let i = 0; i < 6; i++) down("Enter");
    expect(events.filter((e) => e === "SELECT_HOLD")).toHaveLength(2);
  });

  it("leaves navigation keys untouched", () => {
    const { events, down } = harness();
    down("ArrowDown");
    down("Escape");
    expect(events).toEqual(["SWIPE_DOWN", "BACK"]);
  });
});
