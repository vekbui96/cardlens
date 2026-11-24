import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SetsView } from "./SetsView.tsx";
import { SET_SORTS, type SetGroups } from "./setGroups.ts";

const NO_GROUPS: SetGroups = {
  inProgress: [],
  complete: [],
  rest: [],
  started: [],
  hiddenByFilter: 0,
};

describe("SetsView sort chips", () => {
  it("renders every sort chip inside one single-row container", () => {
    render(
      <SetsView
        groups={NO_GROUPS}
        isLoading={false}
        isError={false}
        onRetry={() => {}}
        query=""
        onQuery={() => {}}
        hasCollection
        sort="recent"
        onSort={() => {}}
      />,
    );
    const row = screen.getByTestId("sort-chips");
    expect(within(row).getAllByRole("button")).toHaveLength(SET_SORTS.length);
    expect(within(row).getByRole("button", { name: "Most valuable" })).toBeInTheDocument();
  });
});
