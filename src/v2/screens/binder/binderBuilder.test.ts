import { describe, expect, it } from "vitest";
import {
  countBinder,
  emptyBinder,
  placeSlot,
  setCover,
  slotAt,
  type Binder,
  type CardSlot,
} from "../../../models/binderLayout.ts";
import { SyncAuthError, SyncDisabledError, SyncTooLargeError } from "../../../services/sync/http.ts";
import type { PokemonCardSummary } from "../../../models/cards.ts";
import {
  afterPlace,
  coverLabel,
  dropWrite,
  footnote,
  imageErrorMessage,
  newSlot,
  pageVars,
  plural,
  pocketLabel,
  prompt,
  removePageState,
  settingTags,
  slotArt,
  slotTitle,
  valueLine,
} from "./binderBuilder.ts";

/**
 * The builder's decisions, without a browser.
 *
 * Nothing here asserts markup. What is tested is the handful of judgements the
 * screen actually makes on top of `models/binderLayout.ts` — which write a drag
 * means, where the selection lands afterwards, and what any of it says out loud
 * — because those are the ones with a plausible wrong answer, and three of them
 * have shipped wrong before.
 */

const NOW = 1_700_000_000_000;

function card(id: string): CardSlot {
  return { kind: "card", cardId: id, finish: "normal", name: id, collectorNumber: "1" };
}

/** A 9-pocket binder with `filled` consecutive pockets on page 1. */
function binderWith(filled: number, pages = 1): Binder {
  let binder = emptyBinder("b1", "Jolteon", "9", NOW);
  for (let page = 0; page < pages; page++) {
    for (let i = 0; i < (page === 0 ? filled : 0); i++) {
      binder = placeSlot(binder, page, i, card(`c${i}`), NOW);
    }
  }
  while (binder.pages.length < pages) binder = { ...binder, pages: [...binder.pages, { slots: {} }] };
  return binder;
}

describe("counting things out loud", () => {
  it("says one card, never one cards", () => {
    expect(plural(1, "card")).toBe("1 card");
    expect(plural(0, "card")).toBe("0 cards");
    expect(plural(2, "page")).toBe("2 pages");
  });

  it("counts a plain binder in cards and pages", () => {
    const binder = binderWith(1);
    expect(footnote(binder, countBinder(binder))).toBe("1 card across 1 page · 9-pocket");
  });

  it("counts a trade binder in COPIES, because that is what is being offered", () => {
    // Twelve pockets can hold thirty cards, and thirty is the number the other
    // collector is deciding about.
    let binder = emptyBinder("b1", "Trade", "4", NOW);
    binder = placeSlot(binder, 0, 0, { ...card("c0"), quantity: 3 }, NOW);
    binder = placeSlot(binder, 0, 1, card("c1"), NOW);
    binder = { ...binder, forTrade: true };
    expect(footnote(binder, countBinder(binder))).toBe("4 cards in 2 pockets across 1 page · 4-pocket");
  });
});

describe("what a pocket is called", () => {
  const base = { index: 4, pageNumber: 2, trade: false, price: 1.5 };

  it("names an empty pocket by its address, so a binder can be filled unseen", () => {
    expect(pocketLabel({ ...base, slot: undefined, held: false })).toBe("Page 2, pocket 5, empty");
  });

  it("says whether the card is owned, because shading is a colour", () => {
    expect(pocketLabel({ ...base, slot: card("c1"), held: false })).toContain("not owned");
    expect(pocketLabel({ ...base, slot: card("c1"), held: true })).toContain("c1, owned");
  });

  it("says a price is unavailable rather than leaving it blank", () => {
    // A blank where a price belongs reads as "still loading" forever.
    expect(pocketLabel({ ...base, slot: card("c1"), held: true, price: undefined })).toContain(
      "price unavailable",
    );
  });

  it("reads the stock as words, and only on a trade binder", () => {
    const stacked: CardSlot = { ...card("c1"), quantity: 3, condition: "LP" };
    expect(pocketLabel({ ...base, slot: stacked, held: true, trade: true })).toContain(
      "3 copies, Lightly played",
    );
    expect(pocketLabel({ ...base, slot: stacked, held: true, trade: false })).not.toContain("copies");
  });

  it("names the cover without an index, because it is not a pocket", () => {
    const binder = setCover(emptyBinder("b1", "Jolteon", "9", NOW), card("c1"), NOW);
    expect(coverLabel(binder)).toBe("Cover, c1");
    expect(coverLabel(emptyBinder("b2", "Jolteon", "9", NOW))).toBe("Cover, empty");
    expect(coverLabel(binder)).not.toContain("pocket");
  });

  it("falls back to the card id when a binder predates the denormalised name", () => {
    expect(slotTitle({ kind: "card", cardId: "base1-4", finish: "holo" })).toBe("base1-4");
    expect(slotTitle({ kind: "image", imageId: "i1" })).toBe("Custom image");
  });

  it("names a custom image by its label, and never claims it is unowned", () => {
    // An image slot is a photo or a divider the owner put there, not a printing
    // the collection could have an opinion about.
    const slot = { kind: "image", imageId: "i1", label: "Divider" } as const;
    const label = pocketLabel({ ...base, slot, held: false });
    expect(label).toContain("Divider");
    expect(label).not.toContain("not owned");
  });
});

describe("art that lives on the server", () => {
  /*
   * Binders in the wild already hold image slots. The bytes are NOT in the
   * binder — it carries a 20-byte id and the URL is resolved at render, because
   * the same binder is opened by a phone on the funnel and a dev build on
   * localhost, and a baked-in absolute URL is wrong on every device but the one
   * that uploaded it.
   */
  it("resolves a server-held image by id rather than storing a URL", () => {
    expect(slotArt({ kind: "image", imageId: "i1" })).toContain("/binders/images/i1");
  });

  it("passes through a src for an image the server does not hold", () => {
    expect(slotArt({ kind: "image", src: "https://example.test/divider.png" })).toBe(
      "https://example.test/divider.png",
    );
  });

  it("uses the card's denormalised art, so a page paints offline", () => {
    expect(slotArt({ ...card("c1"), imageSmall: "https://example.test/art.png" })).toBe(
      "https://example.test/art.png",
    );
  });
});

describe("the total", () => {
  it("shows nothing rather than a zero while the sets are answering", () => {
    // `Money` prints "Pricing…" for this, and must never print $0.00 for a
    // binder nobody has priced yet.
    expect(valueLine({ isLoading: true, total: 0, unpriced: 0 })).toEqual({
      loading: true,
      total: undefined,
      note: "",
    });
  });

  it("carries the unpriced count with the number, so it does not read as the whole answer", () => {
    expect(valueLine({ isLoading: false, total: 12, unpriced: 3 }).note).toBe("3 unpriced");
    expect(valueLine({ isLoading: false, total: 12, unpriced: 0 }).note).toBe("");
  });
});

describe("where the selection goes after a write", () => {
  it("advances to the next empty pocket, so a binder fills card after card", () => {
    // The pocket used to stay put, so every card after the first replaced the
    // one before it and the binder never grew past one card.
    const binder = binderWith(2);
    expect(afterPlace(binder, { kind: "pocket", page: 0, index: 1 }, card("c1"))).toEqual({
      kind: "pocket",
      page: 0,
      index: 2,
    });
  });

  it("stays put when a pocket is CLEARED", () => {
    const at = { kind: "pocket", page: 0, index: 1 } as const;
    expect(afterPlace(binderWith(2), at, null)).toEqual(at);
  });

  it("never steps off the cover into page 1", () => {
    // The cover is one slot, not the first of a run. Advancing would be the app
    // deciding you meant to carry on filling pages.
    expect(afterPlace(binderWith(0), { kind: "cover" }, card("c1"))).toEqual({ kind: "cover" });
  });

  it("gives up rather than wrapping when the binder is full", () => {
    const full = binderWith(9);
    expect(afterPlace(full, { kind: "pocket", page: 0, index: 8 }, card("c8"))).toBeNull();
  });
});

describe("what a drop means", () => {
  const from = { kind: "pocket", page: 0, index: 0 } as const;
  const to = { kind: "pocket", page: 0, index: 1 } as const;

  it("swaps two occupied pockets rather than destroying one", () => {
    const binder = binderWith(2);
    const result = dropWrite(binder, { kind: "address", at: from }, card("c0"), to, NOW);
    expect(slotAt(result.binder, to)).toMatchObject({ cardId: "c0" });
    expect(slotAt(result.binder, from)).toMatchObject({ cardId: "c1" });
  });

  it("does not destroy a card dropped back where it started", () => {
    // The commonest way a drag ends: a press that moved a few pixels, or a
    // change of mind. Two writes to the same address cancel out to a delete.
    const binder = binderWith(1);
    const result = dropWrite(binder, { kind: "address", at: from }, card("c0"), from, NOW);
    expect(slotAt(result.binder, from)).toMatchObject({ cardId: "c0" });
  });

  it("replaces when the card came from the picker, because there is nothing to swap back", () => {
    const binder = binderWith(2);
    const result = dropWrite(binder, { kind: "new" }, card("fresh"), to, NOW);
    expect(slotAt(result.binder, to)).toMatchObject({ cardId: "fresh" });
    expect(slotAt(result.binder, from)).toMatchObject({ cardId: "c0" });
  });

  it("does NOT move the selection when a pocket was rearranged", () => {
    // Dropping a card into pocket 5 and having the picker open on pocket 5
    // answers a question nobody asked, once per card, while a page is tidied.
    const result = dropWrite(binderWith(2), { kind: "address", at: from }, card("c0"), to, NOW);
    expect(result.select).toBeNull();
  });

  it("DOES select when a card was dragged in from the picker", () => {
    // That IS filling, and the panel it opens is where copies, condition and
    // "I own this" are set for the card just placed.
    const result = dropWrite(binderWith(2), { kind: "new" }, card("fresh"), to, NOW);
    expect(result.select).toEqual(to);
  });

  it("carries a card onto the cover without touching the pockets it is counted in", () => {
    const binder = binderWith(1);
    const result = dropWrite(binder, { kind: "address", at: from }, card("c0"), { kind: "cover" }, NOW);
    expect(result.binder.cover).toMatchObject({ cardId: "c0" });
    expect(countBinder(result.binder).filled).toBe(0);
  });
});

describe("removing a page", () => {
  it("refuses the only page, and says why", () => {
    const state = removePageState(binderWith(0));
    expect(state.disabled).toBe(true);
    expect(state.reason).toContain("first page");
  });

  it("refuses a last page that still has cards in it", () => {
    let binder = binderWith(0, 2);
    binder = placeSlot(binder, 1, 0, card("c0"), NOW);
    const state = removePageState(binder);
    expect(state.disabled).toBe(true);
    expect(state.reason).toContain("still has cards");
  });

  it("allows an empty trailing page — nothing trims one automatically", () => {
    // The automatic trim is what made "Add page" a silent no-op: it grew the
    // binder and the same commit dropped the new page again.
    expect(removePageState(binderWith(0, 2))).toEqual({ disabled: false, reason: "" });
  });
});

describe("the rest of the screen's words", () => {
  it("names the chosen pocket the way a person counts one", () => {
    expect(prompt({ kind: "pocket", page: 1, index: 4 })).toContain("Page 2, pocket 5");
    expect(prompt({ kind: "cover" })).toContain("Cover");
    expect(prompt(null)).toContain("Choose a pocket");
  });

  it("shows only what is switched on", () => {
    const base = emptyBinder("b1", "Jolteon", "9", NOW);
    expect(settingTags(base)).toEqual([]);
    expect(settingTags({ ...base, forTrade: true, showValue: true })).toEqual([
      "For trade",
      "Priced in list",
    ]);
  });

  it("gives the page its columns and rows, and nothing else", () => {
    expect(pageVars("9")).toEqual({ "--cols": "3", "--rows": "3" });
    // 12-pocket is four ACROSS and three down, which decides whether a page
    // reads in rows of four or rows of three.
    expect(pageVars("12")).toEqual({ "--cols": "4", "--rows": "3" });
    expect(pageVars("4")).toEqual({ "--cols": "2", "--rows": "2" });
  });

  it("denormalises a catalog card into a slot exactly once", () => {
    // The click and the drag place the identical object; two copies of this is
    // how they come to disagree about a field.
    const summary = {
      id: "sv3-125",
      name: "Charizard ex",
      collectorNumber: "125",
      imageSmall: "https://example.test/art.png",
      setName: "Obsidian Flames",
    } as PokemonCardSummary;
    expect(newSlot(summary, "holo")).toEqual({
      kind: "card",
      cardId: "sv3-125",
      finish: "holo",
      name: "Charizard ex",
      imageSmall: "https://example.test/art.png",
      collectorNumber: "125",
    });
  });
});

describe("an upload that failed", () => {
  /*
   * Four situations, four messages. A single "could not add image" would tell
   * the user nothing about which of them to fix — and three of the four are
   * fixed somewhere different.
   */
  it("distinguishes a rejected token from sync being off, a huge file, and no network", () => {
    const messages = [
      imageErrorMessage(new SyncAuthError()),
      imageErrorMessage(new SyncDisabledError()),
      imageErrorMessage(new SyncTooLargeError()),
      imageErrorMessage(new TypeError("Failed to fetch")),
    ];
    expect(new Set(messages).size).toBe(4);
    expect(messages[0]).toContain("token");
    expect(messages[1]).toContain("sync switched off");
    expect(messages[2]).toContain("too large");
  });

  it("falls back to something a person can read when the failure has no message", () => {
    expect(imageErrorMessage({})).toBe("Could not reach the server to store that image.");
  });
});
