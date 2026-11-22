import { describe, expect, it } from "vitest";
import type { PokemonCardSummary } from "../../../models/cards.ts";
import { sortCards } from "./sortCards.ts";

const card = (id: string, marketPrice?: number): PokemonCardSummary =>
  ({
    id,
    name: "Charizard",
    setName: "Set",
    collectorNumber: "1",
    ...(marketPrice === undefined ? {} : { marketPrice }),
  }) as PokemonCardSummary;

const ids = (cards: PokemonCardSummary[]) => cards.map((c) => c.id);

const input = [card("a", 5), card("none1"), card("b", 50), card("c", 5), card("zero", 0), card("none2")];

describe("sortCards", () => {
  it("best match is the catalog order, untouched", () => {
    expect(ids(sortCards(input, "best"))).toEqual(ids(input));
  });

  it("high to low puts unpriced last and keeps ties in catalog order", () => {
    expect(ids(sortCards(input, "price-desc"))).toEqual(["b", "a", "c", "zero", "none1", "none2"]);
  });

  it("low to high still puts unpriced last, and a real 0 is not unpriced", () => {
    expect(ids(sortCards(input, "price-asc"))).toEqual(["zero", "a", "c", "b", "none1", "none2"]);
  });

  it("does not mutate its input", () => {
    const before = ids(input);
    sortCards(input, "price-desc");
    expect(ids(input)).toEqual(before);
  });
});
