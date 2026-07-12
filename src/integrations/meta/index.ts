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

/**
 * The app's real input: keyboard events (glasses gestures on-device, arrow keys on
 * desktop) combined with a mock channel for the DevPanel's simulated buttons.
 */
export function createInputAdapter(target: EventTarget = window): AppInputAdapter {
  const mock = new MockInputAdapter();
  const adapter = new CompositeInputAdapter([new MetaWearableInputAdapter(target), mock]);
  return { adapter, mock };
}
