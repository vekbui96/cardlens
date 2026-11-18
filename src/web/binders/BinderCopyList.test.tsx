import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Binder } from "../../models/binderLayout.ts";
import { BinderCopyList } from "./BinderCopyList.tsx";

const binder = {
  id: "b1",
  name: "Trades",
  format: "9-pocket",
  pages: [
    {
      slots: {
        0: {
          kind: "card",
          cardId: "a",
          finish: "holofoil",
          name: "Charizard ex",
          collectorNumber: "125",
          quantity: 2,
        },
      },
    },
  ],
  updatedAt: 1,
} as unknown as Binder;

function stubClipboard(writeText: (text: string) => Promise<void>) {
  const writeFn = vi.fn(writeText);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: writeFn } });
  return writeFn;
}

function renderButton() {
  return render(<BinderCopyList binder={binder} priceFor={() => 5} pricesReady />);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BinderCopyList", () => {
  it("copies the list and says so", async () => {
    const user = userEvent.setup();
    const write = stubClipboard(() => Promise.resolve());
    renderButton();
    await user.click(screen.getByRole("button", { name: "Copy list" }));
    expect(write).toHaveBeenCalledOnce();
    const copied = String(write.mock.calls[0]?.[0]);
    expect(copied).toContain("2x Charizard ex - #125 - Holofoil - $10.00");
    expect(copied).toContain("2 cards, 1 priced, about 10.00 USD");
    expect(await screen.findByRole("button", { name: "List copied" })).toBeTruthy();
  });

  it("shows the text in a box to copy by hand when the clipboard refuses", async () => {
    const user = userEvent.setup();
    stubClipboard(() => Promise.reject(new DOMException("denied", "NotAllowedError")));
    renderButton();
    await user.click(screen.getByRole("button", { name: "Copy list" }));
    expect(await screen.findByText(/Copy failed: select and copy/)).toBeTruthy();
    const box = screen.getByLabelText("Binder list") as HTMLTextAreaElement;
    expect(box.value).toContain("Charizard ex");
  });
});
