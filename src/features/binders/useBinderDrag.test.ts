import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type React from "react";
import { useBinderDrag, type DragSource } from "./useBinderDrag.ts";
import type { BinderAddress, BinderSlot } from "../../models/binderLayout.ts";

/**
 * The touch gesture, driven directly.
 *
 * It cannot be asserted in e2e: the phone project is touch-EMULATED, and
 * Chrome's emulation answers a mouse drag by panning — it fires pointercancel
 * on the first move and takes the pointer away, so the gesture never runs. The
 * real thing on real hardware is press, hold, then move, and the hold is the
 * whole design: on a finger, a press that moves is how you scroll a binder
 * taller than the screen. So it is exercised here, with fake timers.
 */

const slot: BinderSlot = { kind: "card", cardId: "me5-1", finish: "normal" };
const source: DragSource = { kind: "address", at: { kind: "pocket", page: 0, index: 0 } };

/** Only the fields the hook reads. A real React.PointerEvent carries far more. */
function press(over: Partial<React.PointerEvent> = {}): React.PointerEvent {
  return {
    button: 0,
    pointerId: 1,
    pointerType: "touch",
    clientX: 100,
    clientY: 100,
    ...over,
  } as React.PointerEvent;
}

/** jsdom has no PointerEvent, so the document-level events are shaped by hand. */
function fire(type: string, x: number, y: number, pointerId = 1) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { clientX: x, clientY: y, pointerId });
  act(() => {
    document.dispatchEvent(event);
  });
}

let target: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  target = document.createElement("div");
  target.setAttribute("data-pocket", "1:4");
  document.body.append(target);
  // jsdom lays nothing out, so the hit test has to be answered for it. What is
  // under the pointer is the browser's job; what the hook does with the answer
  // is this file's.
  document.elementFromPoint = () => target;
});

afterEach(() => {
  vi.useRealTimers();
  target.remove();
});

describe("useBinderDrag on a finger", () => {
  it("picks a card up after a hold, and drops it where the finger lifts", () => {
    const onDrop = vi.fn<(s: DragSource, slot: BinderSlot, to: BinderAddress) => void>();
    const { result } = renderHook(() => useBinderDrag(onDrop));

    act(() => result.current.onPointerDown(press(), source, slot));
    // Nothing yet: a press is a tap until it has lasted.
    expect(result.current.isDragging).toBe(false);

    act(() => void vi.advanceTimersByTime(400));
    expect(result.current.isDragging).toBe(true);

    fire("pointermove", 300, 300);
    fire("pointerup", 300, 300);

    expect(onDrop).toHaveBeenCalledWith(source, slot, { kind: "pocket", page: 1, index: 4 });
    expect(result.current.isDragging).toBe(false);
  });

  it("lets a finger that moves first scroll, instead of dragging", () => {
    // The binder is taller than the screen and the pages are most of it. If a
    // press that moves picked a card up, the screen could not be scrolled at
    // all — every attempt would carry off whatever the thumb landed on.
    const onDrop = vi.fn<(s: DragSource, slot: BinderSlot, to: BinderAddress) => void>();
    const { result } = renderHook(() => useBinderDrag(onDrop));

    act(() => result.current.onPointerDown(press(), source, slot));
    fire("pointermove", 100, 160);
    act(() => void vi.advanceTimersByTime(400));

    expect(result.current.isDragging).toBe(false);
    fire("pointerup", 100, 160);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("keeps the card when the gesture is cancelled mid-air", () => {
    // pointercancel means the browser took the gesture — a scroll, a system
    // sheet. Dropping the card wherever the pointer happened to be would place
    // it somewhere the user never chose.
    const onDrop = vi.fn<(s: DragSource, slot: BinderSlot, to: BinderAddress) => void>();
    const { result } = renderHook(() => useBinderDrag(onDrop));

    act(() => result.current.onPointerDown(press(), source, slot));
    act(() => void vi.advanceTimersByTime(400));
    fire("pointermove", 300, 300);
    fire("pointercancel", 300, 300);

    expect(result.current.isDragging).toBe(false);
    fire("pointerup", 300, 300);
    expect(onDrop).not.toHaveBeenCalled();
  });
});

describe("useBinderDrag on a mouse", () => {
  it("starts on movement rather than on a hold — a click is a press that did not move", () => {
    const onDrop = vi.fn<(s: DragSource, slot: BinderSlot, to: BinderAddress) => void>();
    const { result } = renderHook(() => useBinderDrag(onDrop));

    act(() => result.current.onPointerDown(press({ pointerType: "mouse" }), source, slot));
    // Under the threshold: still a click, and hand tremor must not become one.
    fire("pointermove", 103, 100);
    expect(result.current.isDragging).toBe(false);

    fire("pointermove", 130, 100);
    expect(result.current.isDragging).toBe(true);

    fire("pointerup", 300, 300);
    expect(onDrop).toHaveBeenCalledWith(source, slot, { kind: "pocket", page: 1, index: 4 });
  });

  it("lands a flick that is over before React has re-rendered", () => {
    // The handlers read a ref, not state, precisely for this: a quick drag is
    // pointerdown, a couple of moves and a pointerup inside one frame, and
    // handlers closed over `drag` would run the lot against null and lose it.
    const onDrop = vi.fn<(s: DragSource, slot: BinderSlot, to: BinderAddress) => void>();
    const { result } = renderHook(() => useBinderDrag(onDrop));

    // One act, so React commits nothing in between.
    act(() => {
      result.current.onPointerDown(press({ pointerType: "mouse" }), source, slot);
      for (const [type, x] of [
        ["pointermove", 130],
        ["pointermove", 300],
        ["pointerup", 300],
      ] as const) {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.assign(event, { clientX: x, clientY: 100, pointerId: 1 });
        document.dispatchEvent(event);
      }
    });

    expect(onDrop).toHaveBeenCalledWith(source, slot, { kind: "pocket", page: 1, index: 4 });
  });

  it("ignores a secondary button, which is a context menu and not a drag", () => {
    const onDrop = vi.fn<(s: DragSource, slot: BinderSlot, to: BinderAddress) => void>();
    const { result } = renderHook(() => useBinderDrag(onDrop));

    act(() => result.current.onPointerDown(press({ pointerType: "mouse", button: 2 }), source, slot));
    fire("pointermove", 300, 100);
    expect(result.current.isDragging).toBe(false);
    fire("pointerup", 300, 100);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("drops nothing when the pointer is not over a pocket", () => {
    document.elementFromPoint = () => document.body;
    const onDrop = vi.fn<(s: DragSource, slot: BinderSlot, to: BinderAddress) => void>();
    const { result } = renderHook(() => useBinderDrag(onDrop));

    act(() => result.current.onPointerDown(press({ pointerType: "mouse" }), source, slot));
    fire("pointermove", 300, 100);
    fire("pointerup", 300, 100);

    expect(onDrop).not.toHaveBeenCalled();
  });
});
