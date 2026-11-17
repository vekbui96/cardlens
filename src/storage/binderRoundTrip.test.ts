import { describe, expect, it } from "vitest";
import { Repositories } from "./repositories.ts";
import { VersionedStore, createMemoryStorage } from "./versioned.ts";
import { mergeBinders, pruneBinderTombstones } from "./binders.ts";
import { parseBinder } from "../models/binderParse.ts";
import {
  BINDER_FORMATS,
  specFor,
  type Binder,
  type BinderFormat,
  type CardSlot,
  type ImageSlot,
} from "../models/binderLayout.ts";

/**
 * One binder carrying EVERY field a binder can have, taken the whole way a
 * synced binder travels and compared with what went in.
 *
 *   phone storage -> push (JSON) -> server ingest (parseBinder) -> server merge
 *   -> server file and restart (JSON, parseBinder again) -> pull (JSON)
 *   -> laptop storage
 *
 * The trap this exists for: a field a client can write must be named in the
 * whitelist (`parseSlot` / `parseBinder`) or it silently vanishes on sync —
 * which already cost this codebase `excluded` on the collection twice, and a
 * 4-pocket binder that saved and then disappeared on the next read. The tests
 * around each piece check fields one at a time; nothing else sends one binder
 * through all of them.
 *
 * The fixtures are `satisfies Required<...>`, so adding an optional field to
 * `CardSlot`, `ImageSlot` or `Binder` fails typecheck HERE until the fixture
 * sets it — and once it does, this round trip says whether sync keeps it.
 */

const IMAGE_ID = "Xy7_pQ-r2Lm9.webp";

const fullCard = {
  kind: "card",
  cardId: "sv3-215",
  finish: "reverse:pokeball",
  name: "Charizard ex",
  imageSmall: "https://images.pokemontcg.io/sv3/215.png",
  collectorNumber: "215",
  quantity: 3,
  condition: "LP",
} satisfies Required<CardSlot>;

const fullImage = {
  kind: "image",
  imageId: IMAGE_ID,
  src: "https://example.com/binder-art/divider.png",
  label: "Fire types",
} satisfies Required<ImageSlot>;

const secondCard = {
  kind: "card",
  cardId: "sv3-125",
  finish: "holo",
  name: "Charizard ex",
  imageSmall: "https://images.pokemontcg.io/sv3/125.png",
  collectorNumber: "125",
  quantity: 999,
  condition: "DMG",
} satisfies Required<CardSlot>;

/**
 * A binder per format: trade flag, show-value flag, a cover, a full page with a
 * gap in it, and an empty last page kept on purpose (never trimmed).
 */
function maximalBinder(
  id: string,
  format: BinderFormat,
  cover: CardSlot | ImageSlot,
  now: number,
): Required<Omit<Binder, "deletedAt">> {
  const last = specFor(format).pockets - 1;
  return {
    id,
    name: `Trade binder ${format}`,
    format,
    pages: [
      // Index 1 is left empty on purpose: a sparse page keeps its gap.
      { slots: { 0: fullCard, 2: fullImage, [last]: secondCard } },
      { slots: { 0: { ...fullImage, label: "Second page" } } },
      { slots: {} },
    ],
    forTrade: true,
    showValue: true,
    cover,
    createdAt: now - 60_000,
    updatedAt: now - 1_000,
  };
}

/** A deleted binder, which must travel too or the delete is undone on the next sync. */
function tombstone(id: string, format: BinderFormat, now: number): Required<Binder> {
  return {
    ...maximalBinder(id, format, fullCard, now),
    pages: [],
    deletedAt: now - 500,
  } satisfies Required<Binder>;
}

function device(): Repositories {
  return new Repositories(new VersionedStore(createMemoryStorage()));
}

/** What crosses a network or a file: JSON, and nothing else survives. */
function wire(value: unknown): unknown[] {
  return JSON.parse(JSON.stringify(value)) as unknown[];
}

function serverIngest(payload: unknown[]): Binder[] {
  return payload.flatMap((b) => parseBinder(b) ?? []);
}

/** Saved on one device, synced through the server, read back on another. */
function roundTrip(binders: Binder[]): Binder[] {
  // The phone: the screen saves, and sync pushes the raw records (tombstones too).
  const phone = device();
  for (const binder of binders) phone.saveBinder(binder);
  const pushed = wire(phone.getBinderRecords());

  // The server: validate, merge into what it holds (nothing yet), prune.
  const stored = pruneBinderTombstones(mergeBinders([], serverIngest(pushed)));
  // ...written to disk, and validated again when the service next starts.
  const reloaded = serverIngest(wire(stored));

  // The laptop pulls.
  const laptop = device();
  laptop.mergeIncomingBinders(wire(reloaded) as Binder[]);
  return laptop.getBinderRecords();
}

const byId = (a: Binder, b: Binder) => a.id.localeCompare(b.id);

describe("a maximal binder survives storage, server validation, merge and back", () => {
  for (const format of BINDER_FORMATS) {
    it(`keeps every field of a ${format}-pocket binder`, () => {
      const now = Date.now();
      const original: Binder[] = [
        maximalBinder(`card-cover-${format}`, format, fullCard, now),
        maximalBinder(`image-cover-${format}`, format, fullImage, now),
        tombstone(`deleted-${format}`, format, now),
      ];

      const back = roundTrip(original);

      expect([...back].sort(byId)).toEqual([...original].sort(byId));
      // A tombstone that arrives as a live binder, or not at all, would undo a delete.
      expect(back.find((b) => b.id === `deleted-${format}`)?.deletedAt).toBe(now - 500);
    });
  }

  it("lands on the laptop as the same visible binders the phone had", () => {
    const now = Date.now();
    const phone = device();
    phone.saveBinder(maximalBinder("b1", "9", fullCard, now));
    phone.saveBinder(tombstone("b2", "9", now));

    const laptop = device();
    laptop.mergeIncomingBinders(roundTrip(phone.getBinderRecords()));

    expect(laptop.getBinders()).toEqual(phone.getBinders());
    expect(laptop.getBinders().map((b) => b.id)).toEqual(["b1"]);
  });
});

/**
 * The normalisations sync applies on purpose, pinned as decisions rather than
 * left to look like accidents. Each exists so two ways of saying the same thing
 * converge on the same bytes and cannot ping-pong through last-write-wins.
 */
describe("what sync deliberately normalises", () => {
  const now = Date.now();
  const sent = {
    id: "norm",
    name: "Normalised",
    format: "9",
    forTrade: false,
    showValue: false,
    pages: [
      {
        slots: {
          0: { kind: "card", cardId: "sv3-1", finish: "holofoil", quantity: 1 },
          1: { kind: "card", cardId: "sv3-2", finish: "normal", quantity: 2.7 },
        },
      },
    ],
    createdAt: now - 1_000,
    updatedAt: now,
  } as unknown as Binder;

  const [back] = roundTrip([sent]);

  it("does not store forTrade:false or showValue:false", () => {
    expect("forTrade" in back).toBe(false);
    expect("showValue" in back).toBe(false);
  });

  it("does not store a quantity of one", () => {
    expect(back.pages[0].slots[0]).toEqual({ kind: "card", cardId: "sv3-1", finish: "holo" });
  });

  it("canonicalises a legacy finish name", () => {
    expect((back.pages[0].slots[0] as CardSlot).finish).toBe("holo");
  });

  it("floors a fractional quantity rather than dropping the card", () => {
    expect(back.pages[0].slots[1]).toEqual({ kind: "card", cardId: "sv3-2", finish: "normal", quantity: 2 });
  });
});
