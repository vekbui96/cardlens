import { beforeEach, describe, expect, it } from "vitest";
import type { PokemonCardSummary } from "../../../models/cards.ts";
import {
  clearBrowseList,
  keepsBrowseList,
  neighbours,
  readBrowseList,
  rememberBrowseList,
  swipeStartsOnScroller,
  swipeStep,
} from "./browseList.ts";

describe("swipeStartsOnScroller", () => {
  const build = (html: string) => {
    const host = document.createElement("div");
    host.innerHTML = html;
    return host;
  };

  it("is true inside an overflow-x scroller or on a control, false on plain content", () => {
    const host = build(
      `<div style="overflow-x:auto"><p id="a">x</p></div><button id="b"><i id="c"></i></button><div data-no-swipe><p id="d"></p></div><p id="e"></p>`,
    );
    const at = (id: string) => host.querySelector(`#${id}`)!;
    expect(swipeStartsOnScroller(at("a"), host)).toBe(true);
    expect(swipeStartsOnScroller(at("c"), host)).toBe(true);
    expect(swipeStartsOnScroller(at("d"), host)).toBe(true);
    expect(swipeStartsOnScroller(at("e"), host)).toBe(false);
    expect(swipeStartsOnScroller(null, host)).toBe(false);
  });
});

beforeEach(() => {
  sessionStorage.clear();
});

const list = (...cardIds: string[]) => ({ label: "Search results", cardIds });

describe("neighbours", () => {
  it("has no previous on the first card", () => {
    expect(neighbours(list("a", "b", "c"), "a")).toEqual({
      position: 1,
      total: 3,
      next: { cardId: "b" },
    });
  });

  it("has no next on the last card", () => {
    expect(neighbours(list("a", "b", "c"), "c")).toEqual({
      position: 3,
      total: 3,
      previous: { cardId: "b" },
    });
  });

  it("has both in the middle", () => {
    expect(neighbours(list("a", "b", "c"), "b")).toEqual({
      position: 2,
      total: 3,
      previous: { cardId: "a" },
      next: { cardId: "c" },
    });
  });

  it("is nothing for a card that is not in the list, a one-card list, or no list", () => {
    expect(neighbours(list("a", "b"), "z")).toBeNull();
    expect(neighbours(list("a"), "a")).toBeNull();
    expect(neighbours(null, "a")).toBeNull();
  });

  it("counts a card held in two printings once", () => {
    expect(neighbours(list("a", "a", "b"), "a")).toEqual({ position: 1, total: 2, next: { cardId: "b" } });
  });
});

describe("remembering a list", () => {
  it("round-trips through the session, without repeats", () => {
    rememberBrowseList("Everything owned", [{ cardId: "a" }, { cardId: "a" }, { cardId: "b" }]);
    expect(readBrowseList()).toEqual({ label: "Everything owned", cardIds: ["a", "b"] });
  });

  it("hands the tapped summary to the neighbour", () => {
    const summary = { id: "b", name: "Bulbasaur" } as PokemonCardSummary;
    rememberBrowseList("Search results", [{ cardId: "a" }, { cardId: "b", summary }]);
    expect(neighbours(readBrowseList(), "a")?.next).toEqual({ cardId: "b", summary });
  });

  it("reads anything malformed as no list", () => {
    sessionStorage.setItem("cardlens:v2:browse-list", "{not json");
    expect(readBrowseList()).toBeNull();
    sessionStorage.setItem("cardlens:v2:browse-list", JSON.stringify({ label: 3, cardIds: "a" }));
    expect(readBrowseList()).toBeNull();
  });
});

describe("forgetting a list", () => {
  it("clearBrowseList leaves no list, so a card in the old list gets no arrows", () => {
    rememberBrowseList("Search results", [{ cardId: "a" }, { cardId: "b" }]);
    clearBrowseList();
    expect(readBrowseList()).toBeNull();
    expect(neighbours(readBrowseList(), "a")).toBeNull();
  });

  it("only the list screens and details keep it", () => {
    for (const name of ["details", "results", "owned", "collection"])
      expect(keepsBrowseList(name)).toBe(true);
    for (const name of ["home", "wantlist", "sets", "set", "favorites"])
      expect(keepsBrowseList(name)).toBe(false);
  });
});

describe("swipeStep", () => {
  it("steps next on a long leftward swipe and previous on a rightward one", () => {
    expect(swipeStep(-80, 10)).toBe(1);
    expect(swipeStep(80, -10)).toBe(-1);
  });

  it("ignores short or mostly-vertical movement", () => {
    expect(swipeStep(-40, 0)).toBe(0);
    expect(swipeStep(-80, 60)).toBe(0);
  });
});
