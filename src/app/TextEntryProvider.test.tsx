import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LayoutMode } from "./layoutMode.ts";
import { LayoutModeProvider } from "./contexts.tsx";
import { TextEntryProvider, useTextEntry } from "./TextEntryProvider.tsx";

/**
 * jsdom's matchMedia stub reports `matches: false` for everything, which is
 * exactly what a touchscreen reports for `(pointer: fine)`. So these tests run
 * under the same condition that produced the bug on a real phone.
 */
function Probe() {
  const { provider } = useTextEntry();
  return <span data-testid="provider">{provider.id}</span>;
}

function renderIn(mode: LayoutMode) {
  render(
    <LayoutModeProvider mode={mode}>
      <TextEntryProvider>
        <Probe />
      </TextEntryProvider>
    </LayoutModeProvider>,
  );
  return screen.getByTestId("provider").textContent;
}

describe("text entry provider by shell", () => {
  it("gives a phone the browser prompt, not the glasses letter picker", () => {
    // The reported bug: searching on the phone opened the on-glasses D-pad
    // speller. It is built for a device with NO keyboard; a phone has one on
    // screen. The pointer heuristic could not tell them apart because a
    // touchscreen is `pointer: coarse`, never `fine`.
    expect(renderIn("web")).toBe("browser-prompt");
  });

  it("keeps the letter picker on the glasses", () => {
    // No keyboard exists there and none can be summoned — the picker is the
    // only way to spell anything without the companion phone.
    expect(renderIn("glasses")).toBe("on-glasses");
  });

  it("keeps the preview shell behaving like the glasses it previews", () => {
    expect(renderIn("preview")).toBe("on-glasses");
  });
});
