import type { WearableInputAdapter, WearableInputEvent } from "../../models/input.ts";
import { MetaWearableInputAdapter } from "./MetaWearableInputAdapter.ts";
import { MockInputAdapter } from "./MockInputAdapter.ts";

export { MetaWearableInputAdapter } from "./MetaWearableInputAdapter.ts";
export { KeyboardInputAdapter } from "./KeyboardInputAdapter.ts";
export { MockInputAdapter } from "./MockInputAdapter.ts";
export { KeyboardBackedInputAdapter } from "./KeyboardBackedInputAdapter.ts";
export { KEY_TO_EVENT, eventForKey, isEditableTarget } from "./keyMap.ts";

/** Fan several adapters into one subscription (keyboard + dev-panel mock). */
export class CompositeInputAdapter implements WearableInputAdapter {
  constructor(private readonly adapters: WearableInputAdapter[]) {}

  subscribe(listener: (event: WearableInputEvent) => void): () => void {
    const unsubs = this.adapters.map((a) => a.subscribe(listener));
    return () => unsubs.forEach((u) => u());
  }
}

export interface AppInputAdapter {
  adapter: WearableInputAdapter;
  /** Exposed so the DevPanel can inject simulated Neural Band events. */
  mock: MockInputAdapter;
}

export interface InputOptions {
  /**
   * Listen to the keyboard at all.
   *
   * On the glasses the four gestures ARE keyboard events, so this is the whole
   * adapter. On the web those same keys belong to the page — arrows scroll,
   * Enter submits, Escape closes — and `MetaWearableInputAdapter`
   * `preventDefault()`s all three at the document as soon as anything
   * subscribes. Turning it off here is how the v2 shell guarantees no screen
   * of its own can take them, rather than relying on every screen to opt out.
   */
  wearable?: boolean;
}

/**
 * The app's real input: keyboard events (glasses gestures on-device, arrow keys on
 * desktop) combined with a mock channel for the DevPanel's simulated buttons.
 */
export function createInputAdapter(
  target: EventTarget = window,
  { wearable = true }: InputOptions = {},
): AppInputAdapter {
  const mock = new MockInputAdapter();
  const sources: WearableInputAdapter[] = wearable ? [new MetaWearableInputAdapter(target), mock] : [mock];
  return { adapter: new CompositeInputAdapter(sources), mock };
}
