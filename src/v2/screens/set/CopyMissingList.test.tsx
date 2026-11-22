import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MissingListSlot } from "../../../web/sets/missingListText.ts";
import { CopyMissingList } from "./CopyMissingList.tsx";

function slot(name: string, n: string, over: Partial<MissingListSlot> = {}): MissingListSlot {
  return { collectorNumber: n, finish: "normal", held: false, excluded: false, card: { name }, ...over };
}

const priceFor = (n: string) => (n === "1" ? 1.5 : undefined);
const missing = [slot("Bulbasaur", "1"), slot("Ivysaur", "2")];

function setClipboard(writeText: ((t: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText ? { writeText } : undefined,
    configurable: true,
  });
}

afterEach(() => setClipboard(undefined));

describe("CopyMissingList", () => {
  it("is absent while printings are unknown and when nothing is missing", () => {
    const { container, rerender } = render(
      <CopyMissingList slots={missing} priceFor={priceFor} setName="S" printingsKnown={false} />,
    );
    expect(container.textContent).toBe("");
    rerender(
      <CopyMissingList
        slots={[slot("A", "1", { held: true }), slot("B", "2", { excluded: true })]}
        priceFor={priceFor}
        setName="S"
        printingsKnown
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("copies the exact list for every missing printing", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    // After setup(): user-event installs its own clipboard stub.
    setClipboard(writeText);
    render(<CopyMissingList slots={missing} priceFor={priceFor} setName="Paldea" printingsKnown />);
    await user.click(screen.getByRole("button", { name: "Copy missing list" }));
    expect(writeText).toHaveBeenCalledWith(
      "Paldea: missing 2 of 2\nBulbasaur #1 - $1.50\nIvysaur #2 - unpriced",
    );
    expect(await screen.findByRole("button", { name: "Missing list copied" })).toBeInTheDocument();
  });

  it("shows the text in a selectable box when the clipboard refuses", async () => {
    const user = userEvent.setup();
    setClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    render(<CopyMissingList slots={missing} priceFor={priceFor} setName="Paldea" printingsKnown />);
    await user.click(screen.getByRole("button", { name: "Copy missing list" }));
    const box = await screen.findByRole("textbox", { name: "Missing list" });
    expect(box).toHaveValue("Paldea: missing 2 of 2\nBulbasaur #1 - $1.50\nIvysaur #2 - unpriced");
    expect(screen.getByRole("alert")).toHaveTextContent("Copy failed");
  });
});
