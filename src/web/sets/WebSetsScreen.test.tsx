import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WebSetsScreen } from "./WebSetsScreen.tsx";

const SETS = [
  { id: "sv3", name: "Obsidian Flames", code: "OBF", series: "Scarlet & Violet", total: 230 },
  { id: "sv2", name: "Paldea Evolved", code: "PAL", series: "Scarlet & Violet", total: 279 },
  { id: "swsh1", name: "Sword & Shield", code: "SSH", series: "Sword & Shield", total: 216 },
];

vi.mock("../../hooks/useSets.ts", () => ({
  useSets: () => ({ data: SETS, isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("../../app/NavigationProvider.tsx", () => ({
  useNavigation: () => ({ openSet: vi.fn(), pop: vi.fn() }),
}));
vi.mock("../../app/LibraryProvider.tsx", () => ({
  useLibrary: () => ({
    ownedCountsBySet: { sv2: 10 },
    ownedNumbersBySet: {},
    collection: [],
    totalFinishesOwned: 0,
    syncStatus: { state: "off" },
    syncNow: vi.fn(),
    setSyncToken: vi.fn(),
  }),
}));
vi.mock("../../app/TextEntryProvider.tsx", () => ({
  useTextEntry: () => ({ provider: { requestInput: vi.fn() } }),
}));
vi.mock("../../app/screenLoaders.tsx", () => ({ usePrefetchProps: () => () => ({}) }));
vi.mock("../collection/ValuePanel.tsx", () => ({ ValuePanel: () => null }));

const find = () => screen.getByRole("searchbox", { name: "Find set" });
const has = (name: string) => screen.queryByRole("button", { name: new RegExp(`^${name}`) }) !== null;

describe("WebSetsScreen find box", () => {
  it("lists every set until something is typed", () => {
    render(<WebSetsScreen />);
    expect(has("Obsidian Flames")).toBe(true);
    expect(has("Paldea Evolved")).toBe(true);
    expect(has("Sword & Shield")).toBe(true);
  });

  it("narrows by name and by series", () => {
    render(<WebSetsScreen />);
    fireEvent.change(find(), { target: { value: "obs" } });
    expect(has("Obsidian Flames")).toBe(true);
    expect(has("Paldea Evolved")).toBe(false);
    fireEvent.change(find(), { target: { value: "scarlet" } });
    expect(has("Obsidian Flames")).toBe(true);
    expect(has("Paldea Evolved")).toBe(true);
    expect(has("Sword & Shield")).toBe(false);
  });

  it("says nothing matches and Clear restores the list", () => {
    render(<WebSetsScreen />);
    fireEvent.change(find(), { target: { value: "zzz" } });
    expect(screen.getByText("No sets match")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByText("No sets match")).not.toBeInTheDocument();
    expect(has("Obsidian Flames")).toBe(true);
  });
});
