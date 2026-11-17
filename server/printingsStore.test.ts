import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SetPrintings, SetPrintingsReport, TcgdexClient } from "../src/integrations/tcgdex/client.ts";
import {
  PARTIAL_PRINTINGS_TTL_MS,
  PRINTINGS_CACHE_VERSION,
  PRINTINGS_TTL_MS,
  PrintingsStore,
} from "./printingsStore.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cardlens-printings-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const PRINTINGS: SetPrintings = {
  tcgdexSetId: "sv01",
  byNumber: { "1": [{ type: "normal" }, { type: "reverse" }] },
};

const FULLER: SetPrintings = {
  tcgdexSetId: "sv01",
  byNumber: { "1": [{ type: "normal" }], "2": [{ type: "normal" }], "3": [{ type: "holo" }] },
};

function report(printings: SetPrintings, skippedCards = 0): SetPrintingsReport {
  return { printings, skippedCards };
}

/** Only `buildSetPrintings` is reached by the store. */
function client(buildSetPrintings: () => Promise<SetPrintingsReport | null>): TcgdexClient {
  return { buildSetPrintings: vi.fn(buildSetPrintings) } as unknown as TcgdexClient;
}

function seed(setId: string, value: SetPrintings, ageMs: number, skippedCards?: number): void {
  writeFileSync(
    join(dir, `${setId}.json`),
    JSON.stringify({
      at: Date.now() - ageMs,
      v: PRINTINGS_CACHE_VERSION,
      value,
      ...(skippedCards ? { skippedCards } : {}),
    }),
  );
}

function seedStale(setId: string, value: SetPrintings): void {
  seed(setId, value, PRINTINGS_TTL_MS + 1);
}

describe("PrintingsStore", () => {
  it("coalesces concurrent asks for one set into a single upstream run", async () => {
    const tcgdex = client(() => new Promise((resolve) => setTimeout(() => resolve(report(PRINTINGS)), 0)));
    const store = new PrintingsStore(dir, tcgdex);

    const results = await Promise.all([
      store.get("sv1", "Scarlet & Violet"),
      store.get("sv1", "Scarlet & Violet"),
    ]);

    expect(tcgdex.buildSetPrintings).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.value)).toEqual([PRINTINGS, PRINTINGS]);
  });

  it("serves a stale copy rather than failing when upstream is down", async () => {
    seedStale("sv1", PRINTINGS);
    const store = new PrintingsStore(
      dir,
      client(() => Promise.reject(new Error("tcgdex responded 503"))),
    );

    expect(await store.get("sv1", "Scarlet & Violet")).toEqual({
      value: PRINTINGS,
      cached: true,
      complete: true,
    });
  });

  it("serves the stale copy to every caller of a coalesced fetch that fails", async () => {
    // The caller that joins a run already in flight must get the same fallback
    // as the one that started it. It used to get the rejection, so a set screen
    // lost its printings while a usable entry sat in memory.
    seedStale("sv1", PRINTINGS);
    const tcgdex = client(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error("tcgdex responded 503")), 0)),
    );
    const store = new PrintingsStore(dir, tcgdex);

    const results = await Promise.allSettled([
      store.get("sv1", "Scarlet & Violet"),
      store.get("sv1", "Scarlet & Violet"),
    ]);

    expect(tcgdex.buildSetPrintings).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      { status: "fulfilled", value: { value: PRINTINGS, cached: true, complete: true } },
      { status: "fulfilled", value: { value: PRINTINGS, cached: true, complete: true } },
    ]);
  });

  it("throws when it has never had an answer to give", async () => {
    const store = new PrintingsStore(
      dir,
      client(() => Promise.reject(new Error("tcgdex responded 503"))),
    );
    await expect(store.get("sv1", "Scarlet & Violet")).rejects.toThrow("tcgdex responded 503");
  });

  describe("an incomplete set (cards skipped during a TCGdex burst)", () => {
    it("is rebuilt once the short window has passed", async () => {
      // Live: xy10 was cached at 119 of 125 numbers and would have been served
      // as fresh for 30 days.
      seed("xy10", PRINTINGS, PARTIAL_PRINTINGS_TTL_MS + 1, 6);
      const tcgdex = client(() => Promise.resolve(report(FULLER)));
      const store = new PrintingsStore(dir, tcgdex);

      const result = await store.get("xy10", "Fates Collide");

      expect(tcgdex.buildSetPrintings).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ value: FULLER, cached: false, complete: true });
      // The complete build replaced it on disk, with no skip count.
      const onDisk = JSON.parse(readFileSync(join(dir, "xy10.json"), "utf8")) as Record<string, unknown>;
      expect(onDisk.value).toEqual(FULLER);
      expect(onDisk.skippedCards).toBeUndefined();
    });

    it("is still served from cache inside the short window, flagged incomplete", async () => {
      seed("xy10", PRINTINGS, 60_000, 6);
      const tcgdex = client(() => Promise.resolve(report(FULLER)));
      const store = new PrintingsStore(dir, tcgdex);

      expect(await store.get("xy10", "Fates Collide")).toEqual({
        value: PRINTINGS,
        cached: true,
        complete: false,
      });
      expect(tcgdex.buildSetPrintings).not.toHaveBeenCalled();
    });

    it("leaves a complete entry of the same age alone", async () => {
      // Guard: the short window applies only to incomplete entries.
      seed("xy7", PRINTINGS, PARTIAL_PRINTINGS_TTL_MS + 1);
      const tcgdex = client(() => Promise.resolve(report(FULLER)));
      const store = new PrintingsStore(dir, tcgdex);

      expect(await store.get("xy7", "Ancient Origins")).toEqual({
        value: PRINTINGS,
        cached: true,
        complete: true,
      });
      expect(tcgdex.buildSetPrintings).not.toHaveBeenCalled();
    });

    it("is reported incomplete when freshly built with skipped cards", async () => {
      const tcgdex = client(() => Promise.resolve(report(PRINTINGS, 2)));
      const store = new PrintingsStore(dir, tcgdex);

      expect(await store.get("sv1", "Scarlet & Violet")).toEqual({
        value: PRINTINGS,
        cached: false,
        complete: false,
      });
      const onDisk = JSON.parse(readFileSync(join(dir, "sv1.json"), "utf8")) as Record<string, unknown>;
      expect(onDisk.skippedCards).toBe(2);
    });

    it("never replaces a fuller entry with a worse partial rebuild", async () => {
      // A rebuild that lands inside the next burst must not make the set worse.
      seed("xy10", FULLER, PARTIAL_PRINTINGS_TTL_MS + 1, 1);
      const tcgdex = client(() => Promise.resolve(report(PRINTINGS, 40)));
      const store = new PrintingsStore(dir, tcgdex);

      const first = await store.get("xy10", "Fates Collide");
      expect(first.value).toEqual(FULLER);
      expect(first.complete).toBe(false);

      // Re-stamped, so it waits out another short window instead of rebuilding
      // on every request.
      const second = await store.get("xy10", "Fates Collide");
      expect(second).toEqual({ value: FULLER, cached: true, complete: false });
      expect(tcgdex.buildSetPrintings).toHaveBeenCalledTimes(1);
    });
  });
});
