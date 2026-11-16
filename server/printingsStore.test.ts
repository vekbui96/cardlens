import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SetPrintings, TcgdexClient } from "../src/integrations/tcgdex/client.ts";
import { PRINTINGS_CACHE_VERSION, PRINTINGS_TTL_MS, PrintingsStore } from "./printingsStore.ts";

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

/** Only `getSetPrintings` is reached by the store. */
function client(getSetPrintings: () => Promise<SetPrintings | null>): TcgdexClient {
  return { getSetPrintings: vi.fn(getSetPrintings) } as unknown as TcgdexClient;
}

function seedStale(setId: string, value: SetPrintings): void {
  writeFileSync(
    join(dir, `${setId}.json`),
    JSON.stringify({ at: Date.now() - PRINTINGS_TTL_MS - 1, v: PRINTINGS_CACHE_VERSION, value }),
  );
}

describe("PrintingsStore", () => {
  it("coalesces concurrent asks for one set into a single upstream run", async () => {
    const tcgdex = client(() => new Promise((resolve) => setTimeout(() => resolve(PRINTINGS), 0)));
    const store = new PrintingsStore(dir, tcgdex);

    const results = await Promise.all([
      store.get("sv1", "Scarlet & Violet"),
      store.get("sv1", "Scarlet & Violet"),
    ]);

    expect(tcgdex.getSetPrintings).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.value)).toEqual([PRINTINGS, PRINTINGS]);
  });

  it("serves a stale copy rather than failing when upstream is down", async () => {
    seedStale("sv1", PRINTINGS);
    const store = new PrintingsStore(
      dir,
      client(() => Promise.reject(new Error("tcgdex responded 503"))),
    );

    expect(await store.get("sv1", "Scarlet & Violet")).toEqual({ value: PRINTINGS, cached: true });
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

    expect(tcgdex.getSetPrintings).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      { status: "fulfilled", value: { value: PRINTINGS, cached: true } },
      { status: "fulfilled", value: { value: PRINTINGS, cached: true } },
    ]);
  });

  it("throws when it has never had an answer to give", async () => {
    const store = new PrintingsStore(
      dir,
      client(() => Promise.reject(new Error("tcgdex responded 503"))),
    );
    await expect(store.get("sv1", "Scarlet & Violet")).rejects.toThrow("tcgdex responded 503");
  });
});
