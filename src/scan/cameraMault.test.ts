import { describe, expect, it } from "vitest";
import { combineWithMault, lookalikesIn, MERGED_CANDIDATES, type MaultOpinion } from "./cameraMault.ts";
import type { CardIndex, IndexedCard, ScanResult } from "./cardIndex.ts";

const NAMES: Record<string, string> = {
  "g1-56": "Dodrio",
  "xy8-117": "Dodrio",
  "cel25c-93_A": "Gardevoir ex",
  "ex15-93": "Gardevoir ex δ",
};
const card = (id: string, name = NAMES[id] ?? `Card ${id}`): IndexedCard => ({
  id,
  name,
  number: id.split("-")[1] ?? "1",
  setId: id.split("-")[0],
  setName: id.split("-")[0],
  rarity: null,
});

function phash(ids: string[], confident = false): ScanResult {
  const candidates = ids.map((id, i) => ({ card: card(id), distance: i * 2 }));
  return {
    match: candidates[0] ? { ordinal: 0, distance: 0 } : null,
    runnerUp: candidates[1] ? { ordinal: 1, distance: 2 } : null,
    confident,
    candidates,
  };
}

function mault(ids: string[], confident: boolean, confidence: number | null = 0.99): MaultOpinion {
  return {
    confident,
    reason: confident ? "Mault 99% sure" : "Mault: another card looks almost the same — check the number",
    candidates: ids.map((id, i) => ({ card: card(id), distance: 0.08 + i * 0.1, confidence })),
  };
}

/** No card in these fixtures has a look-alike reprint unless a test says so. */
const none = () => false;

const ids = (r: ScanResult) => r.candidates.map((c) => c.card.id);

describe("combineWithMault", () => {
  it("settles the row when a confident Mault names phash's top candidate", () => {
    const out = combineWithMault(phash(["a-1", "b-2", "c-3"]), mault(["a-1"], true), none);
    expect(out.confirmed).toBe(true);
    expect(out.result.confident).toBe(true);
    expect(ids(out.result)[0]).toBe("a-1");
    expect(out.reason).toMatch(/agree/);
  });

  it("settles on phash's SECOND candidate when Mault confirms it, and moves it first", () => {
    const out = combineWithMault(phash(["a-1", "b-2", "c-3"]), mault(["b-2", "x-9"], true), none);
    expect(out.confirmed).toBe(true);
    expect(ids(out.result)[0]).toBe("b-2");
    expect(new Set(ids(out.result))).toEqual(new Set(["b-2", "x-9", "a-1", "c-3"]));
  });

  it("never accepts a card phash did not offer, however sure Mault is", () => {
    const out = combineWithMault(phash(["a-1", "b-2", "c-3"]), mault(["x-9"], true, 0.999), none);
    expect(out.confirmed).toBe(false);
    expect(out.result.confident).toBe(false);
    // Mault's pick is still offered, first, because it was sure.
    expect(ids(out.result)).toEqual(["x-9", "a-1", "b-2", "c-3"]);
    expect(out.reason).toMatch(/didn't/);
  });

  it("leaves a same-art pair asking when Mault is unsure, phash order first", () => {
    const out = combineWithMault(
      phash(["g1-56", "xy8-117", "c-3"]),
      mault(["xy8-117", "g1-56"], false),
      none,
    );
    expect(out.confirmed).toBe(false);
    expect(ids(out.result)).toEqual(["g1-56", "xy8-117", "c-3"]);
    expect(out.reason).toMatch(/almost the same/);
  });

  it("de-duplicates and caps the merged list", () => {
    const out = combineWithMault(
      phash(["a-1", "b-2", "c-3"]),
      mault(["c-3", "d-4", "e-5", "f-6"], false),
      none,
    );
    expect(ids(out.result)).toEqual(["a-1", "b-2", "c-3", "d-4", "e-5"]);
    expect(out.result.candidates).toHaveLength(MERGED_CANDIDATES);
  });

  it("carries Mault's score onto a card both named, so it reads as a % match", () => {
    const out = combineWithMault(phash(["a-1", "b-2"]), mault(["b-2"], false, 0.8), none);
    expect(out.result.candidates.find((c) => c.card.id === "b-2")?.confidence).toBe(0.8);
    expect(out.result.candidates.find((c) => c.card.id === "a-1")?.confidence).toBeUndefined();
  });

  it("an empty Mault answer changes nothing but the reason", () => {
    const out = combineWithMault(
      phash(["a-1", "b-2"]),
      { confident: false, candidates: [], reason: "none" },
      none,
    );
    expect(out.confirmed).toBe(false);
    expect(ids(out.result)).toEqual(["a-1", "b-2"]);
  });

  it("a confident Mault with no phash candidates at all is not accepted", () => {
    const out = combineWithMault(phash([]), mault(["a-1"], true), none);
    expect(out.confirmed).toBe(false);
    expect(ids(out.result)).toEqual(["a-1"]);
  });

  it("refuses when another card on the row shares the name (a reprint pair)", () => {
    // Mault's collection lacks one of the pair, so it is sure of the twin it knows.
    const out = combineWithMault(phash(["cel25c-93_A", "ex15-93", "c-3"]), mault(["ex15-93"], true), none);
    expect(out.confirmed).toBe(false);
    expect(out.reason).toMatch(/same art/);
  });

  it("refuses a card with a same-name look-alike in the index, even if phash did not offer the twin", () => {
    const out = combineWithMault(phash(["a-1", "b-2"]), mault(["a-1"], true), (id) => id === "a-1");
    expect(out.confirmed).toBe(false);
    expect(out.result.confident).toBe(false);
  });
});

describe("lookalikesIn", () => {
  const index: CardIndex = {
    version: "t",
    // a-1 and a-2 are 3 bits apart; b-1 is 3 bits from a-1 but named differently; a-3 is far.
    hashes: new Uint32Array([0, 0, 0b111, 0, 0b111000, 0, 0xffffffff, 0xffff]),
    cards: [card("a-1", "Pikachu"), card("a-2", "Pikachu ex"), card("b-1", "Raichu"), card("a-3", "Pikachu")],
  };
  const has = lookalikesIn(index);

  it("finds a same-name card within the bit budget", () => {
    expect(has("a-1")).toBe(true);
    expect(has("a-2")).toBe(true);
  });

  it("ignores different names and distant art", () => {
    expect(has("b-1")).toBe(false);
    expect(has("a-3")).toBe(false);
  });

  it("treats an id the index does not hold as unsafe", () => {
    expect(has("zz-9")).toBe(true);
  });
});
