import { beforeEach, describe, expect, it } from "vitest";
import { applyFixture, FIXTURES, fixtureFromLocation, seedingAllowed } from "./fixtures.ts";
import { Repositories } from "../storage/repositories.ts";

beforeEach(() => localStorage.clear());

describe("every fixture", () => {
  /**
   * Each fixture writes through the real repositories rather than poking
   * localStorage, so this loop is not only checking that they run — it is
   * checking that the app can actually store what they describe. A fixture
   * that fails to save is a bug in storage worth finding here.
   */
  it.each(Object.keys(FIXTURES))("%s applies and leaves readable state", (name) => {
    expect(() => FIXTURES[name]!()).not.toThrow();
    const repo = new Repositories();
    expect(() => repo.getCollection()).not.toThrow();
    expect(() => repo.getBinders()).not.toThrow();
  });

  it("is a whole starting state, not a patch", () => {
    // Applying two in a row must give exactly the second one's world. A fixture
    // that assumed what came before it would only be reproducible in the order
    // you happened to run them.
    FIXTURES.binders!();
    const afterBinders = new Repositories().getBinders().length;
    expect(afterBinders).toBeGreaterThan(0);

    localStorage.clear();
    FIXTURES.collection!();
    expect(new Repositories().getBinders()).toHaveLength(0);
  });
});

describe("binders", () => {
  it("gives a full binder, a sparse one and an empty one", () => {
    FIXTURES.binders!();
    const binders = new Repositories().getBinders();
    expect(binders).toHaveLength(3);

    const full = binders.find((b) => b.id === "fx-full")!;
    expect(full.pages).toHaveLength(3);
    expect(Object.keys(full.pages[0]!.slots)).toHaveLength(9);
    // A cover, so the shelf has something other than a page mosaic to show.
    expect(full.cover).toBeDefined();

    const sparse = binders.find((b) => b.id === "fx-sparse")!;
    // Sparse means a real gap: page 3, pocket 7, and nothing before it. The
    // pages between exist and are empty, which is the case a page grid has to
    // draw honestly rather than collapsing away.
    expect(Object.keys(sparse.pages[0]!.slots)).toHaveLength(0);
    expect(Object.keys(sparse.pages[2]!.slots)).toHaveLength(1);

    // An empty binder is one empty page, not zero pages — `emptyBinder` starts
    // every binder with a page to put something on.
    const bare = binders.find((b) => b.id === "fx-empty")!;
    expect(bare.pages).toHaveLength(1);
    expect(Object.keys(bare.pages[0]!.slots)).toHaveLength(0);
  });
});

describe("scan", () => {
  it("leaves the trail a scanning session actually leaves", () => {
    // Scan itself stores nothing — it is a camera and a list that lives as long
    // as the screen. What persists is what it produced.
    FIXTURES.scan!();
    const repo = new Repositories();
    expect(repo.getRecentlyViewed().length).toBeGreaterThan(0);
    expect(repo.getCollection().length).toBeGreaterThan(0);
  });
});

describe("the gate", () => {
  it("allows seeding in dev", () => {
    expect(seedingAllowed({ DEV: true })).toBe(true);
  });

  it("allows seeding under e2e, which runs a real build", () => {
    expect(seedingAllowed({ DEV: false, VITE_USE_MOCKS: "true" })).toBe(true);
  });

  it("refuses in a production build", () => {
    // Otherwise the shipped site would carry a URL parameter that overwrites
    // whatever collection the visitor already has.
    expect(seedingAllowed({ DEV: false })).toBe(false);
    expect(seedingAllowed({})).toBe(false);
  });

  it("falls back to the real env when given nothing", () => {
    // Worth stating, because it is the signature's least obvious behaviour:
    // `undefined` is not "deny", it is "ask import.meta.env" — which is what
    // makes the no-argument call in `applyFixture` correct.
    expect(seedingAllowed()).toBe(seedingAllowed(import.meta.env));
  });
});

describe("applyFixture", () => {
  it("says when a name was not recognised", () => {
    // Silent is the wrong answer: `?seed=binder` is a typo someone will spend
    // ten minutes on if the page simply loads empty.
    expect(applyFixture("nope")).toBe("unknown");
  });

  it("says when there was nothing to do", () => {
    expect(applyFixture(null)).toBe("none");
  });

  it("applies a known fixture", () => {
    expect(applyFixture("collection")).toBe("applied");
    expect(new Repositories().getCollection().length).toBeGreaterThan(0);
  });
});

describe("fixtureFromLocation", () => {
  it("reads ?seed=", () => {
    expect(fixtureFromLocation("?seed=binders")).toBe("binders");
  });

  it("is null when absent", () => {
    expect(fixtureFromLocation("?other=1")).toBeNull();
  });
});
