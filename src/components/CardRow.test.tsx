import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CardRow } from "./CardRow.tsx";
import type { PokemonCardSummary } from "../models/cards.ts";

const card = (over: Partial<PokemonCardSummary> = {}): PokemonCardSummary => ({
  id: "me5-1",
  name: "Tropius",
  setName: "Pitch Black",
  setCode: "PBL",
  collectorNumber: "1",
  ...over,
});

describe("CardRow printing badges", () => {
  it("labels each printing when a card has several", () => {
    render(<CardRow card={card()} availableFinishes={["normal", "reverse", "holo"]} showFinishes />);
    expect(screen.getByText("N")).toBeInTheDocument();
    expect(screen.getByText("RH")).toBeInTheDocument();
    expect(screen.getByText("H")).toBeInTheDocument();
  });

  it("stays generic for a card with only one printing", () => {
    // ex and full-art cards exist as holo only. "H" there names a choice that
    // does not exist, so it is noise rather than information.
    render(<CardRow card={card()} availableFinishes={["holo"]} showFinishes />);
    expect(screen.queryByText("H")).toBeNull();
    expect(screen.getByLabelText("not owned")).toBeInTheDocument();
  });

  it("shows the generic marker as owned once held", () => {
    render(<CardRow card={card()} availableFinishes={["holo"]} ownedFinishes={["holo"]} showFinishes />);
    expect(screen.getByLabelText("owned")).toBeInTheDocument();
    expect(screen.queryByText("H")).toBeNull();
  });

  it("still labels a held printing the data did not list", () => {
    // Hand-marked patterns must stay visible and removable.
    render(
      <CardRow
        card={card()}
        availableFinishes={["normal"]}
        ownedFinishes={["reverse:masterball"]}
        showFinishes
      />,
    );
    expect(screen.getByText("MB")).toBeInTheDocument();
  });
});
