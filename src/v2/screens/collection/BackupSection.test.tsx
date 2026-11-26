import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const state = vi.hoisted(() => ({
  owned: { rows: [] as unknown[], pending: 0, pricing: 0 },
  binders: [] as unknown[],
}));

vi.mock("../../../hooks/useOwnedCards.ts", () => ({ useOwnedCards: () => state.owned }));
vi.mock("../../../app/LibraryProvider.tsx", () => ({ useLibrary: () => ({ binders: state.binders }) }));

import { BackupSection } from "./BackupSection.tsx";

const rows = [
  { cardId: "sv1-1", setId: "sv1", setName: "S", name: "A", collectorNumber: "1", finish: "normal", at: 1 },
];
const binders = [{ id: "b", name: "B", format: "9", pages: [{ slots: {} }] }];

let downloads: string[] = [];

beforeEach(() => {
  downloads = [];
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("BackupSection", () => {
  it("disables every button and explains the next step when nothing is held", () => {
    state.owned = { rows: [], pending: 0, pricing: 0 };
    state.binders = [];
    render(<BackupSection />);
    expect(screen.getByRole("button", { name: "Owned cards (CSV) · 0" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Binders (JSON) · 0" })).toHaveProperty("disabled", true);
    expect(screen.getByTestId("backup-empty-owned").textContent).toContain("Nothing to back up yet");
    expect(screen.getByTestId("backup-empty-binders").textContent).toContain("New binder");
  });

  it("shows counts and downloads dated files", () => {
    state.owned = { rows, pending: 0, pricing: 0 };
    state.binders = binders;
    render(<BackupSection />);
    fireEvent.click(screen.getByRole("button", { name: "Owned cards (CSV) · 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Binders (JSON) · 1" }));
    expect(downloads[0]).toMatch(/^cardlens-owned-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(downloads[1]).toMatch(/^cardlens-binders-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it("holds back the owned-card files while sets are still pricing", () => {
    state.owned = { rows, pending: 0, pricing: 2 };
    state.binders = binders;
    render(<BackupSection />);
    expect(screen.getByRole("button", { name: "Owned cards (CSV) · 1" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Binders (CSV) · 1" })).toHaveProperty("disabled", false);
  });
});
