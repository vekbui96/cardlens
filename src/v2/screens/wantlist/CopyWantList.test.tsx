import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CopyWantList } from "./CopyWantList.tsx";

const sections = [
  {
    setName: "Paldea",
    want: {
      cards: [{ collectorNumber: "1", finish: "normal", price: 1.5, name: "Bulbasaur" }],
      missing: 1,
      priced: 1,
      unpriced: 0,
      total: 1.5,
    },
  },
];

function setClipboard(writeText: ((t: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText ? { writeText } : undefined,
    configurable: true,
  });
}

afterEach(() => setClipboard(undefined));

describe("CopyWantList", () => {
  it("is absent while sets load or nothing is shown", () => {
    const { container, rerender } = render(<CopyWantList sections={sections} notLoaded={0} ready={false} />);
    expect(container.textContent).toBe("");
    rerender(<CopyWantList sections={[]} notLoaded={0} ready />);
    expect(container.textContent).toBe("");
  });

  it("copies the list", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    setClipboard(writeText);
    render(<CopyWantList sections={sections} notLoaded={0} ready />);
    await user.click(screen.getByRole("button", { name: "Copy want list" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Bulbasaur #1 - $1.50"));
    expect(await screen.findByRole("button", { name: "Want list copied" })).toBeInTheDocument();
  });

  it("shows a selectable box when the clipboard refuses", async () => {
    const user = userEvent.setup();
    setClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    render(<CopyWantList sections={sections} notLoaded={0} ready />);
    await user.click(screen.getByRole("button", { name: "Copy want list" }));
    const box = await screen.findByRole("textbox", { name: "Want list" });
    expect((box as HTMLTextAreaElement).value).toContain("Paldea: 1 missing");
  });
});
