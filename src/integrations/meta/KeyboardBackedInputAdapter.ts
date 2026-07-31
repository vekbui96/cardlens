import type { WearableInputAdapter, WearableInputEvent } from "../../models/input.ts";
import { eventForKey, isEditableTarget } from "./keyMap.ts";

/**
 * Shared base: listens to keyboard events on a target and normalizes them to
 * WearableInputEvents. Both the Meta (production) and Keyboard (desktop) adapters
 * use this because, on the glasses, gestures ARE keyboard events.
 *
 * Deliberately keydown-only. A hold gesture was tried here, derived from key-up
 * timing and auto-repeat, and it never fired on the glasses — the platform docs
 * promise `keydown` and nothing else, and that turns out to be literal. Bulk
 * marking is a triple-pinch detected on the screen instead, which uses only
 * documented input and is confirmed working on the device.
 */
export class KeyboardBackedInputAdapter implements WearableInputAdapter {
  private readonly listeners = new Set<(event: WearableInputEvent) => void>();
  private attached = false;

  constructor(private readonly target: EventTarget = window) {}

  private readonly handleKeyDown = (raw: Event): void => {
    const e = raw as KeyboardEvent;
    if (isEditableTarget(e.target)) return;
    const event = eventForKey(e.key);
    if (!event) return;
    // Prevent the browser's default scroll/activation so navigation is ours.
    e.preventDefault();
    this.emit(event);
  };

  protected emit(event: WearableInputEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private attach(): void {
    if (this.attached) return;
    this.target.addEventListener("keydown", this.handleKeyDown);
    this.attached = true;
  }

  private detach(): void {
    if (!this.attached) return;
    this.target.removeEventListener("keydown", this.handleKeyDown);
    this.attached = false;
  }

  subscribe(listener: (event: WearableInputEvent) => void): () => void {
    this.listeners.add(listener);
    this.attach();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.detach();
    };
  }
}
