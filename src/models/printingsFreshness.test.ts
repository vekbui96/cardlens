import { describe, expect, it } from "vitest";
import {
  isProvisionalCacheControl,
  printingsStaleTime,
  PRINTINGS_STALE_MS,
  PROVISIONAL_STALE_MS,
  withProvisional,
} from "./printingsFreshness.ts";

const PRINTINGS = { tcgdexSetId: "xy10", byNumber: { "1": [{ type: "normal" }] } };

describe("isProvisionalCacheControl", () => {
  it("reads the server's one-hour answer as provisional", () => {
    // What /api/printings sends when TCGdex skipped cards during the build.
    expect(isProvisionalCacheControl("public, max-age=3600")).toBe(true);
    expect(isProvisionalCacheControl("max-age=60")).toBe(true);
  });

  it("reads the 30-day answer as complete", () => {
    expect(isProvisionalCacheControl("public, max-age=2592000")).toBe(false);
    expect(isProvisionalCacheControl("public, max-age=3601")).toBe(false);
  });

  it("treats a missing or unreadable header as complete, as every answer was before it", () => {
    expect(isProvisionalCacheControl(null)).toBe(false);
    expect(isProvisionalCacheControl(undefined)).toBe(false);
    expect(isProvisionalCacheControl("")).toBe(false);
    expect(isProvisionalCacheControl("no-store")).toBe(false);
  });
});

describe("withProvisional", () => {
  it("leaves a complete answer exactly as it was", () => {
    // The same object, so nothing new can reach printingsCache.
    expect(withProvisional(PRINTINGS, false)).toBe(PRINTINGS);
    expect(withProvisional(null, true)).toBeNull();
  });

  it("flags a provisional answer without touching its data", () => {
    expect(withProvisional(PRINTINGS, true)).toEqual({ ...PRINTINGS, provisional: true });
    expect(PRINTINGS).not.toHaveProperty("provisional");
  });
});

describe("printingsStaleTime", () => {
  it("trusts a provisional answer for an hour and a complete one for 30 days", () => {
    expect(printingsStaleTime({ state: { data: { ...PRINTINGS, provisional: true } } })).toBe(
      PROVISIONAL_STALE_MS,
    );
    expect(PROVISIONAL_STALE_MS).toBe(60 * 60_000);
    expect(printingsStaleTime({ state: { data: PRINTINGS } })).toBe(PRINTINGS_STALE_MS);
    expect(PRINTINGS_STALE_MS).toBe(30 * 24 * 60 * 60_000);
    expect(printingsStaleTime({ state: { data: undefined } })).toBe(PRINTINGS_STALE_MS);
    expect(printingsStaleTime({ state: { data: null } })).toBe(PRINTINGS_STALE_MS);
  });
});
