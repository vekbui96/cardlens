import { parseNameRows, type NameRow } from "../models/cardNames.ts";

/**
 * The distinct card names, fetched once and kept for the session.
 *
 * Deliberately NOT `card-index/cards-<version>.json`, which is 2.29MB of
 * per-printing metadata for the scanner. This file is the 20,205 cards
 * collapsed to their ~4,451 distinct names with a printings count each — 86KB,
 * about 25KB over the wire — which is what makes on-device autocomplete
 * affordable at all.
 *
 * Same lazy-once pending-promise shape as `scan/cardIndex.ts`, so four search
 * boxes mounting at different times share one fetch rather than racing.
 */

function base(): string {
  // Vite's base is "/cardlens/" in production and "/" in dev; public/ lands
  // beside it either way.
  return import.meta.env.BASE_URL;
}

let pending: Promise<NameRow[]> | null = null;

export function loadCardNames(): Promise<NameRow[]> {
  pending ??= (async () => {
    const latest = (await fetch(`${base()}card-index/latest.json`).then((r) => {
      if (!r.ok) throw new Error(`names manifest ${r.status}`);
      return r.json();
    })) as { version: string };

    const rows = parseNameRows(
      await fetch(`${base()}card-index/names-${latest.version}.json`).then((r) => {
        if (!r.ok) throw new Error(`names ${r.status}`);
        return r.json();
      }),
    );
    if (!rows) throw new Error("names file is not a list of [name, printings]");
    return rows;
  })();
  return pending;
}

/**
 * Forget the fetch.
 *
 * Used between tests, and after a failure so a later focus can try again —
 * a rejected promise cached forever would mean one flaky load disables
 * autofill for the rest of the session.
 */
export function resetCardNames(): void {
  pending = null;
}
