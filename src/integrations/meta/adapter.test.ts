import { describe, expect, it, vi } from "vitest";
import type { WearableInputEvent } from "../../models/input.ts";
import { eventForKey, isEditableTarget } from "./keyMap.ts";
import { MetaWearableInputAdapter } from "./MetaWearableInputAdapter.ts";
import { MockInputAdapter } from "./MockInputAdapter.ts";

describe("keyMap", () => {
  it("maps documented Meta keys to events", () => {
    expect(eventForKey("ArrowUp")).toEqual({ type: "SWIPE_UP" });
    expect(eventForKey("ArrowDown")).toEqual({ type: "SWIPE_DOWN" });
    expect(eventForKey("ArrowLeft")).toEqual({ type: "SWIPE_LEFT" });
    expect(eventForKey("ArrowRight")).toEqual({ type: "SWIPE_RIGHT" });
    expect(eventForKey("Enter")).toEqual({ type: "SELECT" });
    expect(eventForKey("Escape")).toEqual({ type: "BACK" });
  });

  it("ignores unmapped keys", () => {
    expect(eventForKey("a")).toBeNull();
    expect(eventForKey("Tab")).toBeNull();
  });

  it("detects editable targets", () => {
    const input = document.createElement("input");
    const div = document.createElement("div");
    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(div)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("MetaWearableInputAdapter", () => {
  it("emits events for keydown and unsubscribes cleanly", () => {
    const adapter = new MetaWearableInputAdapter(document);
    const events: WearableInputEvent[] = [];
    const unsub = adapter.subscribe((e) => events.push(e));

    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(events).toEqual([{ type: "SWIPE_DOWN" }, { type: "SELECT" }]);

    unsub();
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(events).toHaveLength(2);
  });

  it("does not hijack keys while typing in an input", () => {
    const adapter = new MetaWearableInputAdapter(document);
    const listener = vi.fn();
    const unsub = adapter.subscribe(listener);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(listener).not.toHaveBeenCalled();
    unsub();
    input.remove();
  });
});

describe("MockInputAdapter", () => {
  it("emits via helpers", () => {
    const adapter = new MockInputAdapter();
    const events: WearableInputEvent[] = [];
    adapter.subscribe((e) => events.push(e));
    adapter.swipeUp();
    adapter.select();
    adapter.back();
    expect(events).toEqual([{ type: "SWIPE_UP" }, { type: "SELECT" }, { type: "BACK" }]);
  });
});
