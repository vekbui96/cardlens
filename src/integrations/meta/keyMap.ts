import type { WearableInputEvent } from "../../models/input.ts";

/**
 * The Meta Ray-Ban Display glasses OS emits STANDARD keyboard events for Neural
 * Band + captouch gestures (verified — docs/meta-web-app.md). This map is the
 * single source of truth shared by the production (Meta) and desktop (Keyboard)
 * adapters — they are the same mechanism.
 *
 *   Swipe up/down/left/right -> Arrow keys
 *   Index-finger pinch       -> Enter   (SELECT)
 *   Middle-finger pinch      -> Escape  (BACK)
 */
export const KEY_TO_EVENT: Record<string, WearableInputEvent["type"]> = {
  ArrowUp: "SWIPE_UP",
  ArrowDown: "SWIPE_DOWN",
  ArrowLeft: "SWIPE_LEFT",
  ArrowRight: "SWIPE_RIGHT",
  Enter: "SELECT",
  Escape: "BACK",
};

export function eventForKey(key: string): WearableInputEvent | null {
  const type = KEY_TO_EVENT[key];
  return type ? ({ type } as WearableInputEvent) : null;
}

/**
 * When focus is inside a real text field (the companion page, or a dev prompt),
 * the app must NOT hijack arrows/Enter/Escape — the field needs them.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable === true;
}
