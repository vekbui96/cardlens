import { describe, expect, it } from "vitest";
import { Repositories } from "../../storage/repositories.ts";
import { VersionedStore, createMemoryStorage } from "../../storage/versioned.ts";
import { mergeBinders, referencedImageIds } from "../../storage/binders.ts";
import { MAX_NAME, parseBinder } from "../../models/binderParse.ts";
import type { Binder, CardSlot, ImageSlot } from "../../models/binderLayout.ts";
import { copyName, duplicateBinder } from "./duplicateBinder.ts";

const NOW = 1_763_000_000_000;

const card: CardSlot = {
  kind: "card",
  cardId: "sv3-215",
  finish: "reverse:pokeball",
  name: "Charizard ex",
  imageSmall: "https://images.pokemontcg.io/sv3/215.png",
  collectorNumber: "215",
  quantity: 3,
  condition: "LP",
};

const IMAGE_ID = "Xy7_pQ-r2Lm9.webp";
const image: ImageSlot = { kind: "image", imageId: IMAGE_ID, label: "Fire types" };

/** Everything a binder can carry, including the two flags the copy must drop. */
function original(): Binder {
  return {
    id: "b-original",
    name: "Fire types",
    format: "12",
    pages: [
      // Index 1 empty on purpose, and a blank last page: both must survive.
      { slots: { 0: card, 2: image } },
      { slots: {} },
    ],
    forTrade: true,
    showValue: true,
    cover: image,
    createdAt: NOW - 86_400_000,
    updatedAt: NOW - 60_000,
  };
}

describe("duplicateBinder", () => {
  it("copies every page, pocket and the cover under a new id and name", () => {
    const copy = duplicateBinder(original(), "b-copy", NOW);
    expect(copy.id).toBe("b-copy");
    expect(copy.name).toBe("Fire types copy");
    expect(copy.format).toBe("12");
    expect(copy.pages).toEqual(original().pages);
    expect(copy.cover).toEqual(image);
  });

  it("starts the copy's clock now", () => {
    const copy = duplicateBinder(original(), "b-copy", NOW);
    expect(copy.createdAt).toBe(NOW);
    expect(copy.updatedAt).toBe(NOW);
  });

  it("leaves trade and show-value off, absent rather than false", () => {
    // A copy must not become a second live trade link, nor a second priced binder.
    const copy = duplicateBinder(original(), "b-copy", NOW);
    expect("forTrade" in copy).toBe(false);
    expect("showValue" in copy).toBe(false);
  });

  it("never copies a tombstone", () => {
    const copy = duplicateBinder({ ...original(), deletedAt: NOW - 1 }, "b-copy", NOW);
    expect("deletedAt" in copy).toBe(false);
  });

  it("has no cover when the original has none", () => {
    const bare = original();
    delete bare.cover;
    expect("cover" in duplicateBinder(bare, "b-copy", NOW)).toBe(false);
  });

  it("is a deep copy: editing the copy leaves the original alone", () => {
    const source = original();
    const copy = duplicateBinder(source, "b-copy", NOW);
    (copy.pages[0].slots[0] as CardSlot).quantity = 99;
    copy.pages[1].slots[4] = card;
    expect((source.pages[0].slots[0] as CardSlot).quantity).toBe(3);
    expect(source.pages[1].slots).toEqual({});
  });
});

describe("copyName", () => {
  it("keeps the copy of a maximum-length name within what sync accepts", () => {
    // parseBinder DROPS a binder whose name is over MAX_NAME, so an untrimmed
    // copy would save here and never reach another device.
    const longest = "x".repeat(MAX_NAME);
    const name = copyName(longest);
    expect(name.length).toBeLessThanOrEqual(MAX_NAME);
    expect(name.endsWith(" copy")).toBe(true);
    expect(parseBinder(duplicateBinder({ ...original(), name: longest }, "b-copy", NOW))).not.toBeNull();
  });
});

describe("a duplicated binder syncs like any other", () => {
  const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

  it("survives device storage, server validation and merge beside its original", () => {
    const source = original();
    const copy = duplicateBinder(source, "b-copy", NOW);

    const phone = new Repositories(new VersionedStore(createMemoryStorage()));
    phone.saveBinder(source);
    phone.saveBinder(copy);

    const ingested = wire(phone.getBinderRecords()).flatMap((b) => parseBinder(b) ?? []);
    const merged = mergeBinders([], ingested);

    const laptop = new Repositories(new VersionedStore(createMemoryStorage()));
    laptop.mergeIncomingBinders(wire(merged));
    const pulled = laptop.getBinderRecords();

    expect(pulled.find((b) => b.id === "b-original")).toEqual(source);
    expect(pulled.find((b) => b.id === "b-copy")).toEqual(copy);
  });

  it("keeps shared art referenced after either binder is deleted", () => {
    // The server sweeps only images NO live binder references. Deleting the
    // original must not orphan the image the copy still shows.
    const copy = duplicateBinder(original(), "b-copy", NOW);
    const deletedOriginal: Binder = { ...original(), pages: [], deletedAt: NOW };
    expect(referencedImageIds([deletedOriginal, copy]).has(IMAGE_ID)).toBe(true);
  });
});
