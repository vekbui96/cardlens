import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SetView } from "../../../hooks/useSetView.ts";
import type { ParsedCardLine } from "../../../models/cardListParse.ts";
import { PreviewSet } from "./PreviewSet.tsx";

const view: Partial<SetView> = {};
const refetch = vi.fn();

vi.mock("../../../hooks/useSetView.ts", () => ({
  useSetView: () => ({
    cards: [],
    allCards: [],
    printings: null,
    isLoading: false,
    isError: false,
    finishesFor: () => ["normal"],
    priceFor: (n: string, finish: string) => (n === "125" && finish === "holo" ? 8 : undefined),
    headlinePriceFor: (c: { marketPrice?: number }) => c.marketPrice,
    refetch,
    ...view,
  }),
}));

const set = { id: "sv3", name: "Obsidian Flames", code: "OBF" };
const card = (n: string, name: string, marketPrice?: number) => ({
  id: `sv3-${n}`,
  name,
  setName: "Obsidian Flames",
  setCode: "OBF",
  collectorNumber: n,
  ...(marketPrice ? { marketPrice } : {}),
});
const line = (n: number, number: string, extra: Partial<ParsedCardLine> = {}): ParsedCardLine => ({
  ok: true,
  line: n,
  raw: `sv3 ${number}`,
  setCode: "SV3",
  number,
  quantity: 1,
  ...extra,
});

describe("PreviewSet", () => {
  it("shows matched lines with quantity and price, 'Unpriced' when nothing prices them, and reports missing numbers", () => {
    view.allCards = [card("125", "Charizard ex", 4), card("126", "Pidgey")];
    const onMissing = vi.fn();
    render(
      <PreviewSet
        set={set}
        lines={[line(1, "125", { quantity: 2 }), line(2, "126"), line(3, "999")]}
        onMissing={onMissing}
      />,
    );
    expect(screen.getByRole("link", { name: /^Charizard ex, #125 · Normal · ×2, \$8\.00$/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Pidgey, #126 · Normal, Unpriced$/ })).toBeTruthy();
    expect(onMissing).toHaveBeenLastCalledWith("sv3", [
      { line: 3, raw: "sv3 999", reason: "Obsidian Flames has no card number 999." },
    ]);
  });

  it("prices a named printing only as that printing", () => {
    view.allCards = [card("125", "Charizard ex", 4)];
    render(
      <PreviewSet
        set={set}
        lines={[line(1, "125", { finish: "holo" }), line(2, "125", { finish: "reverse" })]}
        onMissing={vi.fn()}
      />,
    );
    expect(screen.getByRole("link", { name: /Holofoil, \$8\.00$/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Reverse Holo, Unpriced$/ })).toBeTruthy();
  });

  it("says a set failed to load, with a retry", () => {
    view.allCards = undefined as never;
    view.isError = true;
    render(<PreviewSet set={set} lines={[line(1, "125")]} onMissing={vi.fn()} />);
    expect(screen.getByText(/Could not load Obsidian Flames/)).toBeTruthy();
    view.isError = false;
  });
});
