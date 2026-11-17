import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { OwnedPrintingRow } from "../../models/ownedSort.ts";
import { WebOwnedCardsScreen } from "./WebOwnedCardsScreen.tsx";

/**
 * The summary line under "My cards", with the owned-cards hook stubbed.
 *
 * Names and prices arrive separately, and the line used to read "pricing…" off
 * the names alone — so once they landed it showed a total and an "unpriced"
 * count while the prices were still on their way. "unpriced" may only appear
 * once pricing has finished.
 */
let stubbed: { rows: OwnedPrintingRow[]; pending: number; pricing: number };

vi.mock("../../hooks/useOwnedCards.ts", () => ({ useOwnedCards: () => stubbed }));
vi.mock("../../app/NavigationProvider.tsx", () => ({ useNavigation: () => ({ push: vi.fn() }) }));
vi.mock("./CardShowcase.tsx", () => ({ CardShowcase: () => null }));

const ROWS: OwnedPrintingRow[] = [
  {
    cardId: "sv1-1",
    setId: "sv1",
    setName: "Scarlet & Violet",
    name: "Sprigatito",
    collectorNumber: "1",
    finish: "normal",
    price: 2.5,
    at: 1,
  },
  {
    cardId: "sv1-2",
    setId: "sv1",
    setName: "Scarlet & Violet",
    name: "Floragato",
    collectorNumber: "2",
    finish: "normal",
    at: 2,
  },
];

beforeEach(() => {
  stubbed = { rows: ROWS, pending: 0, pricing: 0 };
});

describe("WebOwnedCardsScreen summary", () => {
  it("says it is still pricing, and not unpriced, while prices load after names", () => {
    stubbed = { rows: ROWS, pending: 0, pricing: 1 };
    render(<WebOwnedCardsScreen />);
    expect(screen.getByText(/still pricing 1 set…/)).toBeInTheDocument();
    expect(screen.queryByText(/1 unpriced/)).not.toBeInTheDocument();
  });

  it("says it is loading, not pricing, while only names are outstanding", () => {
    stubbed = { rows: ROWS, pending: 2, pricing: 0 };
    render(<WebOwnedCardsScreen />);
    expect(screen.getByText(/loading 2 sets…/)).toBeInTheDocument();
    expect(screen.queryByText(/pricing/)).not.toBeInTheDocument();
    expect(screen.queryByText(/1 unpriced/)).not.toBeInTheDocument();
  });

  it("counts unpriced cards only once pricing has finished", () => {
    render(<WebOwnedCardsScreen />);
    expect(screen.getByText(/1 unpriced/)).toBeInTheDocument();
    expect(screen.queryByText(/pricing/)).not.toBeInTheDocument();
  });
});
