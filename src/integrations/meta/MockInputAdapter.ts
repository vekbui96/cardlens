import type { WearableInputAdapter, WearableInputEvent } from "../../models/input.ts";

/**
 * Programmatic adapter for the DevPanel and tests. Events are pushed via `emit`
 * (or the typed helpers) rather than synthesized from DOM keys, so the on-screen
 * simulated-input buttons and unit tests drive navigation directly.
 */
export class MockInputAdapter implements WearableInputAdapter {
  private readonly listeners = new Set<(event: WearableInputEvent) => void>();

  subscribe(listener: (event: WearableInputEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: WearableInputEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  swipeUp(): void {
    this.emit({ type: "SWIPE_UP" });
  }
  swipeDown(): void {
    this.emit({ type: "SWIPE_DOWN" });
  }
  swipeLeft(): void {
    this.emit({ type: "SWIPE_LEFT" });
  }
  swipeRight(): void {
    this.emit({ type: "SWIPE_RIGHT" });
  }
  select(): void {
    this.emit({ type: "SELECT" });
  }
  back(): void {
    this.emit({ type: "BACK" });
  }
}
