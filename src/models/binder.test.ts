import { describe, expect, it } from "vitest";
import { binderPages, BINDER_PAGE_SIZE, type BinderCard } from "./binder.ts";

const card = (collectorNumber: string, complete = false): BinderCard => ({ collectorNumber, complete });
/** n cards numbered 1..n, with the given 1-based positions complete. */
const run = (n: number, completeAt: number[] = []) =>
  Array.from({ length: n }, (_, i) => card(String(i + 1), completeAt.includes(i + 1)));

describe("binderPages", () => {
  it("splits into pages of nine", () => {
    const pages = binderPages(run(20));

    expect(pages).toHaveLength(3);
    expect(pages.map((p) => p.cards.length)).toEqual([9, 9, 2]);
    expect(pages.map((p) => p.index)).toEqual([1, 2, 3]);
  });

  it("labels each page with the range it actually covers", () => {
    const pages = binderPages(run(20));

    expect([pages[0].from, pages[0].to]).toEqual(["1", "9"]);
    expect([pages[1].from, pages[1].to]).toEqual(["10", "18"]);
    expect([pages[2].from, pages[2].to]).toEqual(["19", "20"]);
  });

  it("keeps collector numbers exactly as given", () => {
    // Numbers are strings and not always numeric — 101a, TG01, SV001 all occur.
    const pages = binderPages([card("TG01"), card("SV001"), card("101a")]);

    expect(pages[0].from).toBe("TG01");
    expect(pages[0].to).toBe("101a");
  });

  it("counts complete cards per page", () => {
    const pages = binderPages(run(18, [1, 2, 3, 12]));

    expect(pages[0].complete).toBe(3);
    expect(pages[1].complete).toBe(1);
  });

  it("marks a page full only when every card on it is complete", () => {
    const pages = binderPages(run(18, [1, 2, 3, 4, 5, 6, 7, 8, 9]));

    expect(pages[0].full).toBe(true);
    expect(pages[1].full).toBe(false);
  });

  it("lets a short final page be full", () => {
    // A set that ends mid-page still finishes. Measuring the last page against
    // nine rather than against its own cards would leave the final page of
    // every set permanently incomplete — Pitch Black ends 3 into page 14.
    const pages = binderPages(run(11, [10, 11]));

    expect(pages[1].cards).toHaveLength(2);
    expect(pages[1].full).toBe(true);
  });

  it("does not mark an empty page full", () => {
    expect(binderPages([])).toEqual([]);
  });

  it("uses nine as the page size", () => {
    expect(BINDER_PAGE_SIZE).toBe(9);
    expect(binderPages(run(9))).toHaveLength(1);
    expect(binderPages(run(10))).toHaveLength(2);
  });

  it("is safe against a nonsense page size", () => {
    expect(binderPages(run(5), 0)).toEqual([]);
    expect(binderPages(run(5), -3)).toEqual([]);
  });
});
