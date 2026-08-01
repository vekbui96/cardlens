import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CardSheet } from "./CardSheet.tsx";
import type { PokemonCardSummary } from "../../models/cards.ts";

const card = {
  id: "me5-007",
  name: "Test Card",
  collectorNumber: "007",
  imageSmall: "",
} as PokemonCardSummary;

function renderSheet(over: Partial<Parameters<typeof CardSheet>[0]> = {}) {
  return render(
    <CardSheet
      card={card}
      finishes={["normal", "reverse"]}
      owned={[]}
      headlinePrice={4.25}
      priceFor={(f) => (f === "normal" ? 1.5 : f === "reverse" ? 4.25 : undefined)}
      onToggle={vi.fn()}
      onClose={vi.fn()}
      {...over}
    />,
  );
}

describe("CardSheet prices", () => {
  it("prices each printing separately", () => {
    renderSheet();

    expect(screen.getByRole("button", { name: /Normal/ })).toHaveTextContent("$1.50");
    expect(screen.getByRole("button", { name: /Reverse Holo/ })).toHaveTextContent("$4.25");
  });

  it("shows Unavailable rather than $0.00 for an unpriced printing", () => {
    // Pattern foils have no upstream price. Zero would read as worthless.
    renderSheet({
      finishes: ["reverse:pokeball"],
      priceFor: () => undefined,
    });

    expect(screen.getByRole("button", { name: /Poké Ball Reverse/ })).toHaveTextContent("Unavailable");
  });

  it("totals only the printings actually owned", () => {
    renderSheet({ owned: ["reverse"] });

    expect(screen.getByTestId("sheet-owned-value")).toHaveTextContent("$4.25");
  });

  it("reports nothing owned as no value rather than zero dollars", () => {
    renderSheet({ owned: [] });

    expect(screen.queryByTestId("sheet-owned-value")).not.toBeInTheDocument();
  });
});
