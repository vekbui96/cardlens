import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { SetGroups, SetRowModel } from "./setGroups.ts";

vi.mock("../../../hooks/useOwnedCards.ts", () => ({
  useOwnedCards: () => ({ rows: [], pending: 0, pricing: 0 }),
}));
vi.mock("../../../app/NavigationProvider.tsx", () => ({ useNavigation: () => ({ push: vi.fn() }) }));

import { OwnedView } from "./OwnedView.tsx";
import { SetsView } from "./SetsView.tsx";

/**
 * A fresh device on Everything owned and on the set list (#165): the same
 * empty state as Home, with the same two ways in, instead of a one-off line.
 */

const EMPTY_HEADING = { name: "Nothing tracked yet", level: 2 } as const;

const setRow = (id: string, name: string): SetRowModel =>
  ({
    set: { id, name, total: 100 },
    tiers: { masterOwned: 0, masterTotal: 100, masterRatio: 0 },
    owned: 0,
  }) as unknown as SetRowModel;

const groups = (rest: SetRowModel[], hiddenByFilter = 0): SetGroups => ({
  inProgress: [],
  complete: [],
  rest,
  started: [],
  hiddenByFilter,
});

const setsView = (over: Partial<Parameters<typeof SetsView>[0]>) => (
  <SetsView
    groups={groups([setRow("sv1", "Scarlet & Violet")])}
    isLoading={false}
    isError={false}
    onRetry={() => {}}
    query=""
    onQuery={() => {}}
    hasCollection={false}
    sort="recent"
    onSort={() => {}}
    {...over}
  />
);

describe("empty collection screens", () => {
  afterEach(cleanup);

  it("Everything owned shows the shared empty state with both actions", () => {
    render(<OwnedView />);
    expect(screen.getByRole("heading", EMPTY_HEADING)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Browse sets/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Search for a card/ })).toBeTruthy();
    expect(screen.queryByText(/Nothing marked owned yet/)).toBeNull();
  });

  it("the set list shows the shared empty state, and still lists every set", () => {
    render(setsView({}));
    expect(screen.getByRole("heading", EMPTY_HEADING)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Browse sets/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Search for a card/ })).toBeTruthy();
    expect(screen.queryByText(/Nothing marked owned yet/)).toBeNull();
    expect(screen.getByText("Scarlet & Violet")).toBeTruthy();
  });

  it("the set list shows no empty state once anything is owned", () => {
    render(setsView({ hasCollection: true }));
    expect(screen.queryByRole("heading", EMPTY_HEADING)).toBeNull();
  });

  it("keeps its own wording when a filter matches nothing in a non-empty collection", () => {
    render(setsView({ hasCollection: true, groups: groups([], 3), query: "zzz" }));
    expect(screen.getByRole("heading", { name: "No set matches that", level: 2 })).toBeTruthy();
    expect(screen.queryByRole("heading", EMPTY_HEADING)).toBeNull();
  });
});
