import { describe, expect, it } from "vitest";
import { catalogCardsParams } from "./catalogParams.ts";

describe("catalogCardsParams", () => {
  it("forwards q, pageSize and select as before", () => {
    const params = catalogCardsParams({ q: "set.id:sv2", pageSize: "250", select: "id,name" });
    expect(params.get("q")).toBe("set.id:sv2");
    expect(params.get("pageSize")).toBe("250");
    expect(params.get("select")).toBe("id,name");
  });

  it("forwards page and orderBy, so a client can read past the 250-card maximum", () => {
    // Dropping `page` made every page request answer page 1 — measured live:
    // Paldea Evolved page=2 came back as page 1, count 250 of 279.
    const params = catalogCardsParams({ q: "set.id:sv2", pageSize: "250", page: "2", orderBy: "number" });
    expect(params.get("page")).toBe("2");
    expect(params.get("orderBy")).toBe("number");
  });

  it.each(["0", "11", "-1", "1.5", "abc", "2e1", ""])(
    "drops page=%j, which is not an integer from 1 to 10",
    (page) => {
      const params = catalogCardsParams({ q: "set.id:sv2", page });
      expect(params.has("page")).toBe(false);
    },
  );

  it("ignores non-string values and anything not whitelisted", () => {
    const params = catalogCardsParams({ q: ["a", "b"], page: ["2"], orderBy: { x: 1 }, foo: "bar" });
    expect([...params.keys()]).toEqual([]);
  });
});
