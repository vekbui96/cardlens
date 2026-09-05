import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PokemonSet } from "../../../models/cards.ts";
import { setTiers } from "../../../models/setCompletion.ts";
import { SetRow } from "./SetsView.tsx";
import { rowLabel, type SetRowModel } from "./setGroups.ts";

/**
 * Base and master are two different numbers, and both have to be readable
 * without seeing colour. That is the one thing about a set row worth asserting:
 * a screen that showed one bar could only ever be telling you about one of the
 * two milestones, and a screen that told them apart by green-against-gold is
 * telling a deutan nothing at all.
 */

const OBF: PokemonSet = {
  id: "sv3",
  name: "Obsidian Flames",
  code: "OBF",
  releaseDate: "2023/08/11",
  total: 230,
  printedTotal: 197,
};

/** `n` base-numbered cards plus `secrets` over-number ones. */
function held(base: number, secrets = 0): string[] {
  return [
    ...Array.from({ length: base }, (_, i) => String(i + 1)),
    ...Array.from({ length: secrets }, (_, i) => String(198 + i)),
  ];
}

function model(set: PokemonSet, owned: string[]): SetRowModel {
  return {
    set,
    tiers: setTiers({ total: set.total, printedTotal: set.printedTotal }, owned),
    owned: owned.length,
  };
}

describe("a set row", () => {
  it("shows BASE and MASTER as two different figures, each with its word", () => {
    render(<SetRow row={model(OBF, held(100, 20))} />);

    expect(screen.getByText("BASE")).toBeInTheDocument();
    expect(screen.getByText("MASTER")).toBeInTheDocument();
    // 100 of the printed run; 120 of the whole set. Two numbers, not one.
    expect(screen.getByText("100/197")).toBeInTheDocument();
    expect(screen.getByText("120/230")).toBeInTheDocument();
  });

  it("says 'complete' in words, so gold is never the only thing carrying it", () => {
    render(<SetRow row={model(OBF, held(197))} />);

    expect(screen.getByText("complete")).toBeInTheDocument();
    expect(screen.getByText("197/197")).toBeInTheDocument();
  });

  it("offers no base tier for a set that has no secrets to be short of", () => {
    // Base is 102/102: base and master are the same achievement, and offering
    // two would be noise.
    const base: PokemonSet = { id: "base1", name: "Base", total: 102, printedTotal: 102 };
    render(<SetRow row={model(base, held(4))} />);

    expect(screen.queryByText("BASE")).not.toBeInTheDocument();
    expect(screen.getByText("MASTER")).toBeInTheDocument();
  });

  it("shows the set size instead of a progress figure when nothing is owned", () => {
    render(<SetRow row={{ set: OBF, tiers: setTiers({ total: 230, printedTotal: 197 }, 0), owned: 0 }} />);

    expect(screen.getByText("230 cards")).toBeInTheDocument();
    expect(screen.queryByText("MASTER")).not.toBeInTheDocument();
  });
});

describe("the accessible name", () => {
  it("spells both tiers out, because the visible row abbreviates them", () => {
    expect(rowLabel(model(OBF, held(100, 20)))).toBe(
      "Obsidian Flames, base set 100 of 197, master set 120 of 230",
    );
  });

  it("says which tier is complete", () => {
    expect(rowLabel(model(OBF, held(197)))).toBe(
      "Obsidian Flames, base set 197 of 197, complete, master set 197 of 230",
    );
  });

  it("does not claim progress on a set with none", () => {
    expect(rowLabel({ set: OBF, tiers: setTiers({ total: 230, printedTotal: 197 }, 0), owned: 0 })).toBe(
      "Obsidian Flames, 230 cards, none owned",
    );
  });
});
