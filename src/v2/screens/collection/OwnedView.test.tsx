import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { OwnedPrintingRow } from "../../../models/ownedSort.ts";
import { ownedToCsv } from "../../../models/ownedCsv.ts";
import { sortOwned } from "../../../models/ownedSort.ts";

const state = vi.hoisted(() => ({
  value: { rows: [] as unknown[], pending: 0, pricing: 0 },
}));

vi.mock("../../../hooks/useOwnedCards.ts", () => ({ useOwnedCards: () => state.value }));
vi.mock("../../../app/NavigationProvider.tsx", () => ({ useNavigation: () => ({ push: vi.fn() }) }));

import { OwnedView } from "./OwnedView.tsx";

const row = (over: Partial<OwnedPrintingRow>): OwnedPrintingRow => ({
  cardId: "sv1-1",
  setId: "sv1",
  setName: "Scarlet & Violet",
  name: "Sprigatito",
  collectorNumber: "1",
  finish: "normal",
  price: 2.5,
  at: 1,
  ...over,
});

const ROWS = [
  row({ cardId: "sv1-1", price: 2.5 }),
  row({ cardId: "sv1-2", name: "Floragato", collectorNumber: "2", price: 10 }),
  row({ cardId: "sv1-3", name: "Meowscarada", collectorNumber: "3", price: undefined }),
];

/** jsdom's Blob has no `text()`, and text decoding drops the BOM: read the bytes. */
const readBytes = (blob: Blob) =>
  new Promise<Uint8Array>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(blob);
  });

let blobs: Blob[] = [];
let downloads: string[] = [];

beforeEach(() => {
  blobs = [];
  downloads = [];
  URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
    blobs.push(b as Blob);
    return "blob:test";
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("OwnedView Download CSV", () => {
  it("saves the listed rows, in the current sort, with an empty price for unpriced cards", async () => {
    state.value = { rows: ROWS, pending: 0, pricing: 0 };
    render(<OwnedView />);

    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));

    expect(blobs).toHaveLength(1);
    const bytes = await readBytes(blobs[0]);
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    // Default sort is price, highest first.
    expect(text).toBe(ownedToCsv(sortOwned(ROWS, "price")));
    expect(text.split("\r\n")[3]).toMatch(/,$/);
    expect(downloads[0]).toMatch(/^cardlens-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it("is not offered while sets are still pricing or loading", () => {
    state.value = { rows: ROWS, pending: 0, pricing: 1 };
    const { unmount } = render(<OwnedView />);
    expect(screen.queryByRole("button", { name: "Download CSV" })).toBeNull();
    unmount();

    state.value = { rows: ROWS, pending: 2, pricing: 0 };
    render(<OwnedView />);
    expect(screen.queryByRole("button", { name: "Download CSV" })).toBeNull();
  });

  it("is not offered for an empty collection", () => {
    state.value = { rows: [], pending: 0, pricing: 0 };
    render(<OwnedView />);
    expect(screen.queryByRole("button", { name: "Download CSV" })).toBeNull();
  });
});
