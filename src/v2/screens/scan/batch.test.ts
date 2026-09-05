import { describe, expect, it } from "vitest";
import {
  applyAnswer,
  batchSummary,
  chosenOf,
  commitEntries,
  isKept,
  newCapture,
  type Capture,
} from "./batch.ts";
import type { Answer } from "./recognise.ts";
import type { IndexedCard, ScanResult } from "../../../scan/cardIndex.ts";

const CHARIZARD: IndexedCard = {
  id: "base1-4",
  name: "Charizard",
  number: "4",
  setId: "base1",
  setName: "Base Set",
  rarity: "Rare Holo",
};
const REPRINT: IndexedCard = { ...CHARIZARD, id: "base2-4", setId: "base2", setName: "Base Set 2" };

function scan(confident: boolean, candidates: IndexedCard[] = [CHARIZARD, REPRINT]): ScanResult {
  return {
    match: { ordinal: 0, distance: 2 },
    runnerUp: candidates.length > 1 ? { ordinal: 1, distance: 4 } : null,
    confident,
    candidates: candidates.map((card, i) => ({ card, distance: i === 0 ? 2 : 4 })),
  };
}

function answered(result: ScanResult): Answer {
  return { kind: "answered", via: "device", result, note: null, failedOver: false };
}

function row(): Capture {
  return newCapture(1, "data:image/jpeg;base64,thumb", "data:image/jpeg;base64,band");
}

describe("folding an answer into a row", () => {
  it("settles a confident match and releases the collector-number crop", () => {
    // A confident row will never show its band, and a batch of thirty must not
    // hold thirty full-resolution crops it will never draw.
    const c = applyAnswer(row(), answered(scan(true)));
    expect(c.choice).toBe(0);
    expect(c.numberBand).toBeNull();
    expect(chosenOf(c)?.card.id).toBe("base1-4");
  });

  it("keeps the crop, and asks, when the artwork could not settle it", () => {
    // 2,042 of 20,205 cards are reprints sharing their art. The printed number
    // is the only thing that separates them, so the pixels have to survive.
    const c = applyAnswer(row(), answered(scan(false)));
    expect(c.choice).toBeNull();
    expect(c.numberBand).not.toBeNull();
    expect(isKept(c)).toBe(false);
  });

  it("records which recogniser answered, and whether it had to", () => {
    const c = applyAnswer(row(), {
      kind: "answered",
      via: "device",
      result: scan(true),
      note: "the server is unreachable — recognised on this device",
      failedOver: true,
    });
    expect(c.via).toBe("device");
    expect(c.failedOver).toBe(true);
  });

  it("marks a rejected token without inventing an answer for the row", () => {
    const c = applyAnswer(row(), { kind: "rejected", note: "the server rejected this device's token" });
    expect(c.tokenRejected).toBe(true);
    expect(c.result).toBeNull();
    expect(c.via).toBeNull();
    expect(isKept(c)).toBe(false);
  });
});

describe("what a row will file", () => {
  it("prefers a hand-named card, without destroying the candidates", () => {
    const settled = applyAnswer(row(), answered(scan(true)));
    const named: Capture = { ...settled, manual: REPRINT };
    expect(chosenOf(named)?.card.id).toBe("base2-4");
    // Changing your mind after correcting a row must not mean rescanning it.
    expect(named.result?.candidates).toHaveLength(2);
  });

  it("files nothing for a rejected row, even once it has been decided", () => {
    const c: Capture = { ...applyAnswer(row(), answered(scan(true))), rejected: true };
    expect(isKept(c)).toBe(false);
    expect(commitEntries([c])).toEqual([]);
  });
});

describe("committing the batch", () => {
  it("writes each kept row once, with its set and number", () => {
    const kept = applyAnswer(row(), answered(scan(true)));
    const reverse: Capture = {
      ...applyAnswer(newCapture(2, "t", "b"), answered(scan(true))),
      finish: "reverse",
    };
    expect(commitEntries([kept, reverse])).toEqual([
      { cardId: "base1-4", finish: "normal", setId: "base1", number: "4" },
      { cardId: "base1-4", finish: "reverse", setId: "base1", number: "4" },
    ]);
  });

  it("skips rows nobody decided rather than guessing at them", () => {
    const unsure = applyAnswer(row(), answered(scan(false)));
    const settled = applyAnswer(newCapture(2, "t", "b"), answered(scan(true)));
    expect(commitEntries([unsure, settled])).toHaveLength(1);
  });

  it("emits two entries for two copies of one card, never a cancelling pair", () => {
    // The reason the screen calls addManyOwned and never a toggle: a pile being
    // digitised overlaps what is already held, and two copies in one batch
    // would toggle each other back off.
    const a = applyAnswer(row(), answered(scan(true)));
    const b = applyAnswer(newCapture(2, "t", "b"), answered(scan(true)));
    const entries = commitEntries([a, b]);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.cardId === "base1-4")).toBe(true);
  });
});

describe("the batch summary", () => {
  it("counts ready, undecided and rejected separately", () => {
    const settled = applyAnswer(row(), answered(scan(true)));
    const unsure = applyAnswer(newCapture(2, "t", "b"), answered(scan(false)));
    const dropped: Capture = {
      ...applyAnswer(newCapture(3, "t", "b"), answered(scan(true))),
      rejected: true,
    };
    expect(batchSummary([settled, unsure, dropped])).toEqual({
      total: 3,
      kept: 1,
      unsure: 1,
      rejected: 1,
    });
  });

  it("does not count a rejected row as still needing a choice", () => {
    // It would read as "1 still needs a choice" for a row the user has already
    // dealt with, which is the one thing the footer must not lie about.
    const dropped: Capture = { ...applyAnswer(row(), answered(scan(false))), rejected: true };
    expect(batchSummary([dropped]).unsure).toBe(0);
  });
});
