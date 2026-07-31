import type { WearableInputAdapter, WearableInputEvent } from "../../models/input.ts";
import { eventForKey, isEditableTarget } from "./keyMap.ts";

/**
 * Shared base: listens to keyboard events on a target and normalizes them to
 * WearableInputEvents. Both the Meta (production) and Keyboard (desktop) adapters
 * use this because, on the glasses, gestures ARE keyboard events.
 */
/** How long SELECT must be held before it counts as a hold. */
export const SELECT_HOLD_MS = 700;
/**
 * Burst (triple-pinch) detection deliberately does NOT live here.
 *
 * It did, and it was too fragile: the adapter has no idea what is focused, so
 * it had to reset on every other event to avoid firing during rapid marking —
 * which meant any incidental swipe between pinches silently killed the burst.
 * The screen knows the focused card, so "three pinches on the same card" is
 * both stricter and more forgiving there.
 */

export class KeyboardBackedInputAdapter implements WearableInputAdapter {
  private readonly listeners = new Set<(event: WearableInputEvent) => void>();
  private attached = false;
  private selectDownAt = 0;
  private holdFired = false;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Whether this device has ever produced a key-up for SELECT.
   *
   * Load-bearing: the platform docs describe keydown ONLY. If SELECT waited for
   * a key-up that never came, selecting would silently stop working on the
   * glasses and the app would be unusable. So SELECT fires on keydown until a
   * key-up proves the device sends them, and only then moves to release — which
   * is the timing a hold needs to stay distinct from a tap.
   */
  private keyUpSupported = false;

  constructor(private readonly target: EventTarget = window) {}

  /**
   * Hold detection without a documented hold gesture.
   *
   * The platform docs describe `keydown` only — no keyup, no stated repeat
   * behaviour — so this listens for whichever arrives:
   *
   *   - a timer armed on the first keydown, cancelled by keyup (works if the
   *     device sends key-up at all), and
   *   - auto-repeat keydowns, which some inputs produce while held.
   *
   * Either path fires SELECT_HOLD exactly once per press, and the plain SELECT
   * is suppressed for that press so a hold is never also a tap.
   */
  private readonly handleKeyDown = (raw: Event): void => {
    const e = raw as KeyboardEvent;
    if (isEditableTarget(e.target)) return;
    const event = eventForKey(e.key);
    if (!event) return;
    e.preventDefault();

    if (event.type !== "SELECT") {
      this.emit(event);
      return;
    }

    if (e.repeat) {
      // Repeat path: the key is still down, so measure from the first press.
      if (!this.holdFired && this.selectDownAt && Date.now() - this.selectDownAt >= SELECT_HOLD_MS) {
        this.holdFired = true;
        this.clearHoldTimer();
        this.emit({ type: "SELECT_HOLD" });
      }
      return;
    }

    this.selectDownAt = Date.now();
    this.holdFired = false;
    this.clearHoldTimer();

    // Until key-up is proven, act on press: a working tap matters far more than
    // a clean hold.
    if (!this.keyUpSupported) this.emit({ type: "SELECT" });

    // Timer path: fires while still held, so feedback lands at the threshold
    // rather than on release.
    this.holdTimer = setTimeout(() => {
      this.holdFired = true;
      this.holdTimer = null;
      this.emit({ type: "SELECT_HOLD" });
    }, SELECT_HOLD_MS);
  };

  /**
   * A device that never sends key-up simply never reaches here, which is why
   * the keydown path stays authoritative until this fires at least once.
   */
  private readonly handleKeyUp = (raw: Event): void => {
    const e = raw as KeyboardEvent;
    if (isEditableTarget(e.target)) return;
    if (eventForKey(e.key)?.type !== "SELECT") return;

    const alreadyEmittedOnPress = !this.keyUpSupported;
    this.keyUpSupported = true;
    this.clearHoldTimer();
    const held = this.holdFired;
    this.selectDownAt = 0;
    this.holdFired = false;
    // Skip when the press already emitted, or this would double-fire the very
    // press that taught us key-up exists.
    if (!held && !alreadyEmittedOnPress) this.emit({ type: "SELECT" });
  };

  private clearHoldTimer(): void {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  protected emit(event: WearableInputEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private attach(): void {
    if (this.attached) return;
    this.target.addEventListener("keydown", this.handleKeyDown);
    this.target.addEventListener("keyup", this.handleKeyUp);
    this.attached = true;
  }

  private detach(): void {
    if (!this.attached) return;
    this.target.removeEventListener("keydown", this.handleKeyDown);
    this.target.removeEventListener("keyup", this.handleKeyUp);
    this.clearHoldTimer();
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
