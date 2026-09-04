import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { CardArt } from "./index.ts";

/**
 * An empty pocket and a card whose art has not loaded mean opposite things —
 * "nothing is here" versus "something is here, you just cannot see it yet" —
 * and they must not look the same.
 *
 * They did. `.art` gives every card a sunken background so transparent art has
 * something to sit on, and behind the empty variant that background filled the
 * pocket with a solid dark rectangle indistinguishable from a face-down card.
 */
describe("CardArt empty", () => {
  it("does not paint a card-shaped surface", () => {
    const { container } = render(<CardArt name="" empty />);
    const host = container.firstElementChild!;
    // Two classes: the shared frame, plus the one that clears its background.
    expect(host.className.split(" ").length).toBeGreaterThan(1);
    expect(host.querySelector("img")).toBeNull();
  });

  it("differs from a card with missing art", () => {
    const { container: emptyPocket } = render(<CardArt name="" empty />);
    const { container: noArt } = render(<CardArt name="Jolteon" />);
    expect(emptyPocket.firstElementChild!.className).not.toBe(noArt.firstElementChild!.className);
    // The face-down card still says which card it is; the empty pocket has
    // nothing to say, and says nothing.
    expect(noArt.textContent).toBe("Jolteon");
    expect(emptyPocket.textContent).toBe("");
  });

  it("is hidden from assistive technology either way", () => {
    // An empty pocket is a gap in a grid. Announcing it would give a screen
    // reader user nine "blank"s per binder page.
    const { container } = render(<CardArt name="" empty />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});
