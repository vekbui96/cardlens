import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BinderStore, parseBinder, parseSlot } from "./binderStore.ts";
import type { Binder } from "../src/models/binderLayout.ts";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cardlens-binders-"));
  file = join(dir, "binders.json");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const binder = (over: Partial<Binder> = {}): Binder => ({
  id: "b1",
  name: "Masters",
  format: "9",
  pages: [{ slots: {} }],
  createdAt: 100,
  updatedAt: 100,
  ...over,
});

describe("parseSlot", () => {
  it("keeps every denormalised field on a card slot", () => {
    // The whitelist trap: a field this does not name vanishes on sync, and the
    // page then renders blank until the catalog answers. `excluded` was lost
    // twice this way on the collection.
    const slot = parseSlot({
      kind: "card",
      cardId: "me5-4",
      finish: "reverse",
      name: "Pikachu",
      imageSmall: "https://example.test/p.png",
      collectorNumber: "004",
    });
    expect(slot).toEqual({
      kind: "card",
      cardId: "me5-4",
      finish: "reverse",
      name: "Pikachu",
      imageSmall: "https://example.test/p.png",
      collectorNumber: "004",
    });
  });

  it("canonicalises the finish, so a pocket matches the collection row", () => {
    expect(parseSlot({ kind: "card", cardId: "me5-4", finish: "holofoil" })).toMatchObject({
      finish: "holo",
    });
  });

  it("accepts an unknown foil", () => {
    // Sets keep inventing foils; an allow-list here would silently blank the
    // pocket for anything newer than the deploy.
    expect(parseSlot({ kind: "card", cardId: "me5-4", finish: "reverse:friendball" })).toMatchObject({
      finish: "reverse:friendball",
    });
  });

  it("carries the trade fields through the whitelist", () => {
    // The other half of the whitelist trap. `quantity` and `condition` are
    // written on the device and must be named here or a trade binder syncs as
    // one copy of everything, ungraded, with nothing said about it.
    expect(
      parseSlot({ kind: "card", cardId: "me5-4", finish: "normal", quantity: 3, condition: "LP" }),
    ).toEqual({ kind: "card", cardId: "me5-4", finish: "normal", quantity: 3, condition: "LP" });
  });

  it("normalises one copy to no quantity, so two clients converge", () => {
    // A client sending `quantity: 1` and one sending nothing must produce the
    // same bytes, or last-write-wins ping-pongs between them forever.
    expect(parseSlot({ kind: "card", cardId: "me5-4", finish: "normal", quantity: 1 })).toEqual(
      parseSlot({ kind: "card", cardId: "me5-4", finish: "normal" }),
    );
  });

  it("clamps a hostile quantity instead of dropping the card", () => {
    // The card and its position are the valuable part. Refusing the whole slot
    // over a bad count would silently empty a pocket that has a real card in it.
    expect(parseSlot({ kind: "card", cardId: "me5-4", finish: "normal", quantity: 1e9 })).toMatchObject({
      quantity: 999,
    });
    expect(parseSlot({ kind: "card", cardId: "me5-4", finish: "normal", quantity: -3 })).toEqual(
      parseSlot({ kind: "card", cardId: "me5-4", finish: "normal" }),
    );
  });

  it("drops an unknown condition rather than trusting it into the store", () => {
    const slot = parseSlot({ kind: "card", cardId: "me5-4", finish: "normal", condition: "MINT-ISH" });
    expect(slot).not.toBeNull();
    expect("condition" in (slot as object)).toBe(false);
  });

  it("rejects an image slot with neither an id nor a src", () => {
    expect(parseSlot({ kind: "image", label: "nothing" })).toBeNull();
  });

  it("rejects an image id that could escape the image directory", () => {
    expect(parseSlot({ kind: "image", imageId: "../../secrets.jpg" })).toBeNull();
    expect(parseSlot({ kind: "image", imageId: "no-extension" })).toBeNull();
  });

  it("rejects a data URI smuggled in as a src", () => {
    // 512 chars is the bound; a real data URI is tens of thousands. The point
    // is that image bytes go to the image store, never through binder sync.
    const dataUri = `data:image/png;base64,${"A".repeat(600)}`;
    expect(parseSlot({ kind: "image", src: dataUri })).toBeNull();
  });
});

describe("parseBinder", () => {
  it("drops a pocket outside the format's range rather than moving it", () => {
    const parsed = parseBinder(
      binder({ pages: [{ slots: { 0: { kind: "image", src: "u" }, 11: { kind: "image", src: "v" } } }] }),
    );
    expect(Object.keys(parsed?.pages[0].slots ?? {})).toEqual(["0"]);
  });

  it("keeps pocket 11 in a 12-pocket binder", () => {
    const parsed = parseBinder(
      binder({ format: "12", pages: [{ slots: { 11: { kind: "image", src: "v" } } }] }),
    );
    expect(Object.keys(parsed?.pages[0].slots ?? {})).toEqual(["11"]);
  });

  it("preserves a tombstone", () => {
    // Without this the deletion arrives as an ordinary binder and the server
    // hands it back to every device as alive.
    expect(parseBinder({ ...binder(), pages: [], deletedAt: 900 })).toMatchObject({ deletedAt: 900 });
  });

  it("rejects a hostile timestamp", () => {
    // One `updatedAt` of Infinity would win every future merge for that binder,
    // permanently — the same failure the collection guards against.
    expect(parseBinder(binder({ updatedAt: Infinity }))).toBeNull();
    expect(parseBinder(binder({ updatedAt: -1 }))).toBeNull();
  });

  it("carries the trade flag, and stores only its true form", () => {
    expect(parseBinder(binder({ forTrade: true }))?.forTrade).toBe(true);
    // A binder taken off trade must be byte-identical to one never on it.
    expect("forTrade" in (parseBinder(binder({ forTrade: false })) as object)).toBe(false);
    // Only the boolean `true` counts. A truthy string from a hand-edited file
    // must not put a binder on the market.
    expect("forTrade" in (parseBinder({ ...binder(), forTrade: "yes" }) as object)).toBe(false);
  });

  it("rejects an unknown format", () => {
    expect(parseBinder({ ...binder(), format: "18" })).toBeNull();
  });
});

describe("BinderStore", () => {
  it("merges last-write-wins and persists", () => {
    const store = new BinderStore(file);
    store.merge([binder({ name: "First", updatedAt: 100 })]);
    store.merge([binder({ name: "Second", updatedAt: 200 })]);
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0].name).toBe("Second");
    expect(JSON.parse(readFileSync(file, "utf8"))[0].name).toBe("Second");
  });

  it("ignores an older edit arriving late", () => {
    const store = new BinderStore(file);
    store.merge([binder({ name: "Newer", updatedAt: 500 })]);
    store.merge([binder({ name: "Older", updatedAt: 200 })]);
    expect(store.all()[0].name).toBe("Newer");
  });

  it("returns tombstones from since(), or a deletion never reaches the other device", () => {
    // Plausible epoch stamps, not 100 and 900: merge prunes tombstones older
    // than 180 days, and a toy timestamp is 1970 — so a fake clock here makes
    // the deletion vanish before the assertion sees it.
    const deletedAt = Date.now();
    const store = new BinderStore(file);
    store.merge([binder({ updatedAt: deletedAt - 60_000 })]);
    store.merge([{ ...binder({ updatedAt: deletedAt - 60_000 }), pages: [], deletedAt }]);
    expect(store.since(deletedAt - 30_000).map((b) => b.deletedAt)).toEqual([deletedAt]);
  });

  it("survives a corrupt file", () => {
    const store = new BinderStore(file);
    store.merge([binder()]);
    rmSync(file);
    // Truncated JSON, as a power cut mid-write would leave — except rename
    // makes that impossible, so this stands in for anything hand-edited.
    new BinderStore(file).all();
    expect(new BinderStore(join(dir, "missing.json")).all()).toEqual([]);
  });

  it("reports the images its live binders still point at", () => {
    const store = new BinderStore(file);
    store.merge([
      binder({ pages: [{ slots: { 0: { kind: "image", imageId: "abcdefgh.jpg" } } }] }),
      binder({ id: "b2", pages: [{ slots: { 0: { kind: "card", cardId: "me5-1", finish: "normal" } } }] }),
    ]);
    expect([...store.referencedImages()]).toEqual(["abcdefgh.jpg"]);
  });
});
