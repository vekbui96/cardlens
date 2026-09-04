import { describe, expect, it } from "vitest";
import { createInputAdapter } from "./index.ts";

/**
 * The web must not lose its arrow keys.
 *
 * `KeyboardBackedInputAdapter` attaches a document-level `keydown` that
 * `preventDefault()`s arrows, Enter and Escape. On the glasses that is the
 * whole input model — those keys ARE the four gestures, and nothing else on the
 * screen wants them. On the web they belong to the page: arrows scroll and move
 * within a `<select>`, Enter submits, Escape closes.
 *
 * v1 avoids the collision by having every web screen pass `enabled: false` to
 * `useWearableInput`, so nothing ever subscribes and the listener is never
 * attached. That is discipline at every call site, forever, and a v2 screen
 * that forgets it would break arrow keys for the whole page with no visible
 * cause. So v2 turns the keyboard source off at the adapter instead.
 */
describe("createInputAdapter", () => {
  it("swallows arrow keys when the wearable source is on", () => {
    const target = new EventTarget();
    const { adapter } = createInputAdapter(target, { wearable: true });
    const stop = adapter.subscribe(() => {});

    const event = new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true });
    target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    stop();
  });

  it("leaves arrow keys to the page when it is off", () => {
    const target = new EventTarget();
    const { adapter } = createInputAdapter(target, { wearable: false });
    const stop = adapter.subscribe(() => {});

    const event = new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true });
    target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    stop();
  });

  it("keeps the mock channel either way, so the DevPanel still works", () => {
    const { adapter, mock } = createInputAdapter(new EventTarget(), { wearable: false });
    const seen: string[] = [];
    const stop = adapter.subscribe((e) => seen.push(e.type));

    mock.select();

    expect(seen).toEqual(["SELECT"]);
    stop();
  });

  it("defaults to on, so the glasses are unaffected by the option existing", () => {
    const target = new EventTarget();
    const { adapter } = createInputAdapter(target);
    const stop = adapter.subscribe(() => {});

    const event = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    stop();
  });
});
