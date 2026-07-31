import type { WearableInputAdapter, WearableInputEvent } from "../../models/input.ts";
import { eventForKey, isEditableTarget } from "./keyMap.ts";

/**
 * Shared base: listens to keyboard events on a target and normalizes them to
 * WearableInputEvents. Both the Meta (production) and Keyboard (desktop) adapters
 * use this because, on the glasses, gestures ARE keyboard events.
 */
/** How long SELECT must be held before it counts as a hold. */
export const SELECT_HOLD_MS = 700;
/** Gap allowed between pinches for them to count as one burst. */
export const SELECT_BURST_MS = 500;
/** Pinches in a burst that trigger the bulk action. */
export const SELECT_BURST_COUNT = 3;

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
  private burstCount = 0;
  private lastSelectAt = 0;

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
      // Any other input ends the burst. Rapid collecting is pinch-swipe-pinch,
      // and without this, marking three cards quickly would fire the bulk
      // action on the third — a burst must mean three pinches on ONE card.
      this.burstCount = 0;
      this.lastSelectAt = 0;
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

    // Triple-pinch: the only bulk gesture built purely from DOCUMENTED input.
    // Hold depends on keyup or auto-repeat, neither of which the platform docs
    // promise, so this is the path that is certain to work on the glasses.
    const now = Date.now();
    this.burstCount = now - this.lastSelectAt <= SELECT_BURST_MS ? this.burstCount + 1 : 1;
    this.lastSelectAt = now;
    if (this.burstCount >= SELECT_BURST_COUNT) {
      this.burstCount = 0;
      this.holdFired = true; // suppress this press's own tap
      this.clearHoldTimer();
      this.emit({ type: "SELECT_HOLD" });
      return;
    }

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
