/**
 * Platform-neutral directional input. The Meta Ray-Ban Display glasses OS turns
 * Neural Band + captouch gestures into standard DOM keyboard events (verified —
 * see docs/meta-web-app.md). We normalize those into these six events so no UI
 * code ever reads a raw `keydown`.
 */
export type WearableInputEvent =
  | { type: "SWIPE_UP" }
  | { type: "SWIPE_DOWN" }
  | { type: "SWIPE_LEFT" }
  | { type: "SWIPE_RIGHT" }
  | { type: "SELECT" }
  | { type: "BACK" };

export type WearableInputType = WearableInputEvent["type"];

export interface WearableInputAdapter {
  /** Subscribe to input events. Returns an unsubscribe function. */
  subscribe(listener: (event: WearableInputEvent) => void): () => void;
}
