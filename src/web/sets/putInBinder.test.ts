import { describe, expect, it } from "vitest";
import { Repositories } from "../../storage/repositories.ts";
import { VersionedStore, createMemoryStorage } from "../../storage/versioned.ts";
import { mergeBinders } from "../../storage/binders.ts";
import { parseBinder } from "../../models/binderParse.ts";
import type { Binder, CardSlot } from "../../models/binderLayout.ts";
import { describePocket, findPrinting, putInBinder } from "./putInBinder.ts";

const NOW = 1_763_000_000_000;

const slot = (cardId: string, finish = "holo"): CardSlot => ({
  kind: "card",
  cardId,
  finish,
  name: cardId,
  imageSmall: `https://images.pokemontcg.io/${cardId}.png`,
  collectorNumber: cardId.split("-")[1],
});

const pikachu = slot("sv3-063", "reverse");

/** A 4-pocket binder: page 1 full, page 2 with pocket 1 empty, pocket 2 full. */
function binder(): Binder {
  return {
    id: "b1",
    name: "Pikachu",
    format: "4",
    pages: [
      { slots: { 0: slot("a-1"), 1: slot("a-2"), 2: slot("a-3"), 3: slot("a-4") } },
      { slots: { 1: { kind: "image", imageId: "Xy7_pQ-r2Lm9.webp", label: "Divider" } } },
    ],
    createdAt: NOW - 86_400_000,
    updatedAt: NOW - 60_000,
  };
}

describe("putInBinder", () => {
  it("places at the first empty pocket, across pages", () => {
    const result = putInBinder(binder(), pikachu, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.at).toEqual({ kind: "pocket", page: 1, index: 0 });
    expect(result.binder.pages[1].slots[0]).toEqual(pikachu);
    expect(result.binder.updatedAt).toBe(NOW);
  });

  it("uses pocket 1 of page 1 when it is free", () => {
    const empty: Binder = { ...binder(), pages: [{ slots: {} }] };
    const result = putInBinder(empty, pikachu, NOW);
    expect(result.ok && result.at).toEqual({ kind: "pocket", page: 0, index: 0 });
  });

  it("leaves every other slot, the cover and the page count untouched", () => {
    const before = { ...binder(), cover: slot("cover-1") };
    const result = putInBinder(before, pikachu, NOW);
    if (!result.ok) throw new Error("expected a placement");
    expect(result.binder.pages).toHaveLength(2);
    expect(result.binder.pages[0]).toEqual(before.pages[0]);
    expect(result.binder.pages[1].slots[1]).toEqual(before.pages[1].slots[1]);
    expect(result.binder.cover).toEqual(before.cover);
    // Pure: the input binder is not mutated.
    expect(before.pages[1].slots[0]).toBeUndefined();
    expect(before.updatedAt).toBe(NOW - 60_000);
  });

  it("refuses a full binder and never adds a page", () => {
    const full = binder();
    full.pages[1].slots[0] = slot("a-5");
    full.pages[1].slots[2] = slot("a-6");
    full.pages[1].slots[3] = slot("a-7");
    const result = putInBinder(full, pikachu, NOW);
    expect(result).toEqual({ ok: false, reason: "full" });
  });

  it("refuses a printing that is already in the binder, and says where", () => {
    const has = binder();
    has.pages[0].slots[2] = pikachu;
    const result = putInBinder(has, { ...pikachu }, NOW);
    expect(result).toEqual({ ok: false, reason: "already", at: { kind: "pocket", page: 0, index: 2 } });
  });

  it("treats another printing of the same card as a different card", () => {
    const has = binder();
    has.pages[0].slots[2] = pikachu;
    const result = putInBinder(has, slot("sv3-063", "normal"), NOW);
    expect(result.ok).toBe(true);
  });
});

describe("findPrinting", () => {
  it("ignores image slots and the cover", () => {
    const b = { ...binder(), cover: pikachu };
    expect(findPrinting(b, pikachu.cardId, pikachu.finish)).toBeNull();
  });
});

describe("describePocket", () => {
  it("counts from one", () => {
    expect(describePocket({ kind: "pocket", page: 2, index: 4 })).toBe("page 3, pocket 5");
  });
});

describe("a binder placed into from the card sheet syncs like any other", () => {
  const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

  it("survives device storage, server validation and merge unchanged", () => {
    const result = putInBinder(binder(), pikachu, NOW);
    if (!result.ok) throw new Error("expected a placement");

    const phone = new Repositories(new VersionedStore(createMemoryStorage()));
    phone.saveBinder(result.binder);
    expect(phone.getBinderRecords().find((b) => b.id === "b1")).toEqual(result.binder);

    const ingested = wire(phone.getBinderRecords()).flatMap((b) => parseBinder(b) ?? []);
    const merged = mergeBinders([], ingested);

    const laptop = new Repositories(new VersionedStore(createMemoryStorage()));
    laptop.mergeIncomingBinders(wire(merged));
    expect(laptop.getBinderRecords().find((b) => b.id === "b1")).toEqual(result.binder);
  });
});
