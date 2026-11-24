import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { SetGroups, SetRowModel } from "./setGroups.ts";

vi.mock("../../../app/NavigationProvider.tsx", () => ({ useNavigation: () => ({ push: vi.fn() }) }));

import { SetsView } from "./SetsView.tsx";

const groups = (rest: SetRowModel[]): SetGroups => ({
  inProgress: [],
  complete: [],
  rest,
  started: [],
  hiddenByFilter: 0,
});

const setsView = (over: Partial<Parameters<typeof SetsView>[0]>) => (
  <SetsView
    groups={groups([])}
    isLoading={true}
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

describe("Collection set list while loading", () => {
  afterEach(cleanup);

  it("shows eight set-row placeholders and says it is loading", () => {
    const { container } = render(setsView({}));
    expect(container.querySelectorAll("[data-skeleton]")).toHaveLength(8);
    expect(screen.getByText("Loading your sets")).toBeTruthy();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("drops the placeholders once the sets arrive", () => {
    const row = {
      set: { id: "sv1", name: "Scarlet & Violet", total: 100 },
      tiers: { masterOwned: 0, masterTotal: 100, masterRatio: 0 },
      owned: 0,
    } as unknown as SetRowModel;
    const { container } = render(setsView({ isLoading: false, groups: groups([row]) }));
    expect(container.querySelectorAll("[data-skeleton]")).toHaveLength(0);
    expect(screen.getByText("Scarlet & Violet")).toBeTruthy();
  });
});
