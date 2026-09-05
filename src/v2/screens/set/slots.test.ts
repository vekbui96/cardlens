import { describe, expect, it } from "vitest";
import type { PokemonCardSummary } from "../../../models/cards.ts";
import type { CollectFinish } from "../../../models/cards.ts";
import {
  buildSlots,
  isBinderOrder,
  NO_FILTERS,
  pagesFor,
  pricedCount,
  visibleSlots,
  type FilterState,
  type SlotSources,
} from "./slots.ts";

/**
 * The decisions, not the markup.
 *
 * Every case below is a bug that actually happened: binder pages drawn over a
 * filtered run, a card marked once when it has three printings, a hand-marked
 * printing disappearing because the set data does not list it, and a set with
 * no prices reporting a confident total.
 */

function card(collectorNumber: string, name = `Card ${collectorNumber}`): PokemonCardSummary {
  return {
    id: `set1-${collectorNumber}`,
    name,
    setName: "A Set",
    setCode: "set1",
    collectorNumber,
  };
}

/** A set of `count` cards, numbered from 1, in collector order. */
function run(count: number): PokemonCardSummary[] {
  return Array.from({ length: count }, (_, i) => card(String(i + 1)));
}

function sources(overrides: Partial<SlotSources> = {}): SlotSources {
  return {
    finishesFor: () => ["normal"],
    ownedFinishes: () => [],
    excludedFinishes: () => [],
    ...overrides,
  };
}

describe("buildSlots", () => {
  it("gives a card with three printings three independent slots", () => {
    // Per-printing, not per-card: a master set keeps the normal, the reverse
    // and the holo in three separate pockets, so a single tile saying
    // "1 of 3 printings" describes a pocket that does not exist.
    const slots = buildSlots(
      [card("4", "Jolteon")],
      sources({ finishesFor: () => ["normal", "reverse", "holo"] }),
    );

    expect(slots).toHaveLength(3);
    expect(slots.map((s) => s.finish)).toEqual(["normal", "reverse", "holo"]);
    expect(new Set(slots.map((s) => s.key)).size).toBe(3);
  });

  it("marks only the printing that is held, never its siblings", () => {
    const slots = buildSlots(
      [card("4")],
      sources({ finishesFor: () => ["normal", "reverse"], ownedFinishes: () => ["reverse"] }),
    );

    expect(slots.map((s) => [s.finish, s.held])).toEqual([
      ["normal", false],
      ["reverse", true],
    ]);
  });

  it("keeps a hand-marked printing the set data does not list", () => {
    // Otherwise a printing already held becomes invisible, and an invisible
    // printing is one that cannot be un-marked.
    const slots = buildSlots(
      [card("4")],
      sources({ finishesFor: () => ["normal"], ownedFinishes: () => ["holo:tinsel"] }),
    );

    expect(slots.map((s) => s.finish)).toEqual(["normal", "holo:tinsel"]);
    expect(slots[1]).toMatchObject({ extra: true, held: true });
  });

  it("falls back to what is held when nothing vouches for the printings", () => {
    const slots = buildSlots(
      [card("4")],
      sources({ finishesFor: () => [], ownedFinishes: () => ["reverse"] }),
    );

    expect(slots.map((s) => s.finish)).toEqual(["reverse"]);
  });

  it("still produces a pocket for a set with no variant data at all", () => {
    // Pitch Black reports no variants for any of its 120 cards. The screen must
    // still be markable — a set that renders nothing cannot be collected.
    const slots = buildSlots(run(120), sources());

    expect(slots).toHaveLength(120);
    expect(slots.every((s) => s.finish === "normal")).toBe(true);
  });

  it("counts an excluded printing as complete, but not as held", () => {
    // A page is done when nothing on it is still wanted, and a promo you have
    // opted out of is not wanted.
    const [slot] = buildSlots([card("4")], sources({ excludedFinishes: () => ["normal"] }));

    expect(slot).toMatchObject({ held: false, excluded: true, complete: true });
  });
});

describe("isBinderOrder — a filtered view is not a binder page", () => {
  it("draws pages when nothing is filtered", () => {
    expect(isBinderOrder(NO_FILTERS)).toBe(true);
  });

  it("refuses pages under a rarity filter", () => {
    // "Page 3" over a rarity-filtered subset names something that does not
    // exist: its range lies, and its 4/9 counts pockets that are not adjacent
    // in any binder.
    expect(isBinderOrder({ ...NO_FILTERS, rarityKey: "ir" })).toBe(false);
  });

  it("refuses pages under missing-only", () => {
    expect(isBinderOrder({ ...NO_FILTERS, missingOnly: true })).toBe(false);
  });

  it("restores pages when the filter is cleared", () => {
    const filtered: FilterState = { rarityKey: "sir", missingOnly: true, showExcluded: false };
    expect(isBinderOrder(filtered)).toBe(false);
    expect(isBinderOrder({ ...filtered, ...NO_FILTERS })).toBe(true);
  });

  it("still draws pages when excluded printings are hidden", () => {
    // Hiding a printing you have opted out of does not break the run: the set
    // without it IS the set being built.
    expect(isBinderOrder({ ...NO_FILTERS, showExcluded: true })).toBe(true);
    expect(isBinderOrder({ ...NO_FILTERS, showExcluded: false })).toBe(true);
  });
});

describe("pagesFor", () => {
  it("lays 120 cards out in nine-pocket pages", () => {
    const slots = buildSlots(run(120), sources());
    const pages = pagesFor(slots, NO_FILTERS);

    // 13 pages and 3 over — the same shape the real set has.
    expect(pages).toHaveLength(14);
    expect(pages[0].cards).toHaveLength(9);
    expect(pages[0]).toMatchObject({ from: "1", to: "9" });
    expect(pages[13].cards).toHaveLength(3);
  });

  it("returns no pages at all under a filter", () => {
    const slots = buildSlots(run(120), sources());
    expect(pagesFor(slots, { ...NO_FILTERS, rarityKey: "ir" })).toEqual([]);
    expect(pagesFor(slots, { ...NO_FILTERS, missingOnly: true })).toEqual([]);
  });

  it("marks a page full only when every pocket on it is done", () => {
    const held = new Set(["set1-1", "set1-2", "set1-3", "set1-4", "set1-5", "set1-6", "set1-7", "set1-8"]);
    const slots = buildSlots(run(9), sources({ ownedFinishes: (id) => (held.has(id) ? ["normal"] : []) }));

    expect(pagesFor(slots, NO_FILTERS)[0]).toMatchObject({ complete: 8, full: false });
  });
});

describe("visibleSlots", () => {
  const held = new Set(["set1-1"]);
  const skipped = new Set(["set1-2"]);
  const build = () =>
    buildSlots(
      run(3),
      sources({
        ownedFinishes: (id) => (held.has(id) ? (["normal"] as CollectFinish[]) : []),
        excludedFinishes: (id) => (skipped.has(id) ? (["normal"] as CollectFinish[]) : []),
      }),
    );

  it("hides excluded printings by default, and reveals them on demand", () => {
    // A printing you cannot see is a printing you cannot put back.
    expect(visibleSlots(build(), NO_FILTERS).map((s) => s.collectorNumber)).toEqual(["1", "3"]);
    expect(
      visibleSlots(build(), { ...NO_FILTERS, showExcluded: true }).map((s) => s.collectorNumber),
    ).toEqual(["1", "2", "3"]);
  });

  it("missing-only leaves out both what is held and what is excluded", () => {
    expect(visibleSlots(build(), { ...NO_FILTERS, missingOnly: true }).map((s) => s.collectorNumber)).toEqual(
      ["3"],
    );
  });
});

describe("pricedCount", () => {
  it("counts only printings that actually have a price", () => {
    // Absent is not zero. A set with no prices must be able to say so rather
    // than reporting a confident total built from nothing.
    const slots = buildSlots(run(3), sources());
    const priceFor = (n: string) => (n === "1" ? 4.5 : undefined);

    expect(pricedCount(slots, priceFor)).toBe(1);
    expect(pricedCount(slots, () => undefined)).toBe(0);
  });
});
