import { describe, expect, it } from "vitest";
import { parseShare } from "./useShare.ts";

/**
 * What a share row is allowed to be.
 *
 * These three rules are the ones with consequences outside this file: a legacy
 * row that stops rendering breaks links people have already sent, a payload
 * trusted without parsing draws untrusted input, and a 404 that differs from a
 * revocation tells a stranger which ids were once real.
 */

const BINDER = {
  kind: "binder",
  at: 1_800_000_000_000,
  binder: {
    id: "b1",
    name: "Trade",
    format: "9",
    pages: [{ slots: { "0": { kind: "card", cardId: "base2-4", finish: "holo", name: "Jolteon" } } }],
    createdAt: 1,
    updatedAt: 2,
  },
};

describe("parseShare", () => {
  it("reads an untagged row as a SET share", () => {
    // `shares.json` on the live server is full of rows minted before trade
    // shares existed. Every one is a set share, and treating an absent tag as
    // unknown would 404 links that are already in other people's hands.
    const share = parseShare({ setId: "base2", setName: "Base Set 2", owned: [] });
    expect(share?.kind).toBe("set");
  });

  it("reads a binder row as a trade share", () => {
    expect(parseShare(BINDER)?.kind).toBe("binder");
  });

  it("canonicalises finishes off the wire", () => {
    // An older client's spelling must not become a second key the UI never
    // looks under — the showcase index is built from these strings.
    const share = parseShare({
      setId: "base2",
      setName: "Base Set 2",
      // `holofoil` is the pre-rename spelling, from `LEGACY` in models/finishes.
      owned: [{ collectorNumber: "4", finish: "holofoil" }],
    });
    expect(share?.kind === "set" && share.owned[0]?.finish).toBe("holo");
  });

  it("drops a malformed printing rather than the whole share", () => {
    // Untrusted input. One bad row must not take the page with it.
    const share = parseShare({
      setId: "base2",
      setName: "Base Set 2",
      owned: [{ collectorNumber: "4", finish: "holo" }, { nonsense: true }, null, "x"],
    });
    expect(share?.kind === "set" && share.owned).toHaveLength(1);
  });

  it("refuses a row that is not a share at all", () => {
    for (const bad of [null, undefined, 42, "share", {}, { setId: "base2" }]) {
      expect(parseShare(bad)).toBeNull();
    }
  });

  it("refuses a binder row whose binder does not parse", () => {
    // `parseBinder` is the whitelist shared with the server. A binder that
    // fails it is not a binder, and half-drawing one would be worse.
    expect(parseShare({ kind: "binder", binder: { nope: true } })).toBeNull();
  });
});
