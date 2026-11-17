import { describe, expect, it } from "vitest";
import { setInformationBody } from "./setInformation.ts";

const PRINTINGS = { tcgdexSetId: "xy10", byNumber: { "1": [{ type: "normal" }] } };
const CARDS = { data: [{ id: "xy10-1" }], count: 1 };

describe("setInformationBody", () => {
  it("says when the printings are incomplete", () => {
    // Fates Collide, built during a TCGdex 503 burst: 119 of 125 numbers.
    const body = setInformationBody("xy10", CARDS, { value: PRINTINGS, complete: false });

    expect(body.printingsComplete).toBe(false);
    // The printings still go out; the client decides how long to keep them.
    expect(body.printings).toEqual(PRINTINGS);
  });

  it("says when the printings are complete", () => {
    const body = setInformationBody("xy10", CARDS, { value: PRINTINGS, complete: true });

    expect(body.printingsComplete).toBe(true);
  });

  it("keeps the envelope callers read", () => {
    const body = setInformationBody("xy10", CARDS, { value: PRINTINGS, complete: true });

    expect(body).toEqual({ setId: "xy10", cards: CARDS, printings: PRINTINGS, printingsComplete: true });
  });

  it("sends null printings, never complete, when there were none", () => {
    expect(setInformationBody("xy10", CARDS, null)).toMatchObject({
      printings: null,
      printingsComplete: false,
    });
    expect(setInformationBody("xy10", CARDS, { value: null, complete: true })).toMatchObject({
      printings: null,
      printingsComplete: false,
    });
  });
});
