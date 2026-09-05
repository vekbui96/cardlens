import { SEALED_KINDS, type SealedKind, type SealedPrice } from "../../../models/sealed.ts";
import { formatUpdated } from "../../../utils/format.ts";

/**
 * The decisions Sealed makes, with no React around them.
 *
 * Sealed is a thin client over a price service that can be down independently
 * of everything else, and over a server that — deliberately — keeps serving
 * yesterday's numbers when the upstream refresh fails ("yesterday's price beats
 * no price", `server/sealedStore.ts`). That is the right call for the data and
 * the wrong call for a screen that does not say so, which is what these
 * functions are for.
 */

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/* --- Which sets this screen is even about --------------------------------- */

/**
 * The sets a collection spans, exactly as `useSealed` derives them.
 *
 * Deliberately duplicated rather than exported from the hook. The hook returns
 * `rows`, `pending` and `missing` and nothing else, and the distinction below —
 * a set still loading versus a set the catalog has never heard of — cannot be
 * made without the id list. Duplicating four lines of pure derivation costs
 * nothing; changing a hook v1's sealed screen also uses would cost that screen.
 */
export function heldSetIds(collection: ReadonlyArray<{ id: string; setId?: string }>): string[] {
  const ids = collection.map((c) => c.setId ?? c.id.slice(0, c.id.lastIndexOf("-")));
  return [...new Set(ids)].filter(Boolean).sort();
}

export interface SealedInput {
  /** Set ids held, from `heldSetIds`. */
  held: string[];
  /** Catalog names by set id. A set missing from here has no name yet. */
  setNames: Record<string, string>;
  /**
   * Whether the set list itself has arrived. Until it has, a set with no name
   * is a set we have not been told about yet — not one that cannot be priced.
   */
  setsLoaded: boolean;
  /** Set ids that came back WITH sealed products. `useSealed`'s rows, by id. */
  answered: string[];
}

export interface SealedStanding {
  /** Held sets the catalog cannot name, so nothing will ever ask about them. */
  unmatched: string[];
  /**
   * Held sets that have not come back at all — see `silentNote` for why this is
   * one number rather than "loading" and "missing" as two.
   */
  silent: number;
  /** The line under the title. Never a bare count. */
  line: string;
  /** The line reports a problem rather than progress. */
  warn: boolean;
  /** Nothing has arrived yet and something still might. Draw the skeleton. */
  waiting: boolean;
  /** There is nothing to show at all. */
  empty: boolean;
}

/**
 * What to say under the heading.
 *
 * ## Why `pending` and `missing` are not used, despite the hook offering them
 *
 * Two separate faults make both of them untrustworthy, and this counts sets
 * itself instead:
 *
 * 1. `useSealed` counts a DISABLED query as pending, and a set's query is
 *    disabled while its name is unknown. A set the catalog has never heard of
 *    would therefore read as "loading 5 more…" for as long as the screen is
 *    open, waiting on a request nobody is ever going to make.
 *    (`homeSummary.pricingSummary` fixes the same shape of bug for card prices.)
 *
 * 2. The hook's `useMemo` is keyed on `queries.map(q => q.dataUpdatedAt)`, and a
 *    query that FAILS never moves `dataUpdatedAt` off zero. So the moment one
 *    set's lookup errors, `pending` and `missing` freeze at whatever they were
 *    when the last SUCCESS landed — a failed set stays "pending" permanently.
 *    Confirmed by e2e: with one set stubbed 404 the screen sat on
 *    "1 still loading" indefinitely. Reported to the integrator.
 *
 * What survives both faults is `rows`, which only ever grows on success. So the
 * arithmetic here is `held − answered − unmatched`, all of which this screen can
 * see for itself.
 */
export function sealedStanding(input: SealedInput): SealedStanding {
  const { held, setNames, setsLoaded, answered } = input;

  if (held.length === 0) {
    return {
      unmatched: [],
      silent: 0,
      line: "No sets collected yet",
      warn: false,
      waiting: false,
      empty: true,
    };
  }

  const unmatched = setsLoaded ? held.filter((id) => !setNames[id]) : [];
  const silent = Math.max(0, held.length - answered.length - unmatched.length);
  const priced = answered.length;

  if (priced === 0) {
    // Nothing at all yet. Something may still be coming, unless every held set
    // is one the catalog cannot name — in which case nothing ever will be.
    return {
      unmatched,
      silent,
      line:
        silent > 0
          ? `Waiting on ${plural(silent, "set", "sets")}…`
          : `No sealed prices for any of your ${plural(held.length, "set", "sets")}`,
      warn: silent === 0,
      waiting: silent > 0,
      empty: true,
    };
  }

  return {
    unmatched,
    silent,
    line:
      silent === 0 && unmatched.length === 0
        ? `All ${plural(held.length, "set", "sets")} priced`
        : `${priced} of ${plural(held.length, "set", "sets")} priced`,
    warn: false,
    waiting: false,
    empty: false,
  };
}

/**
 * The sentence for held sets that never came back.
 *
 * It names all three possibilities on purpose, because all three are live:
 * a request still in flight, a set that genuinely has no sealed product
 * (promos and tins), and a lookup that failed. `useSealed` reports the last two
 * identically — and, while one of its queries is errored, cannot be trusted to
 * distinguish the first either (see `sealedStanding`). Picking the reassuring
 * one would hide a price service that is down behind "promos are not sold in
 * packs". The retry beside it is what makes the ambiguity harmless.
 */
export function silentNote(silent: number): string {
  if (silent <= 0) return "";
  const [subject, verb] = silent === 1 ? ["it is", "has"] : ["they are", "have"];
  return `${plural(silent, "set", "sets")} ${verb} not come back. Either ${subject} still being fetched, or ${subject} not sold sealed — promos and tins are not — or the lookup failed. Nothing here can tell those apart, so ask again if this stays.`;
}

/** The sentence for held sets the catalog could not name. */
export function unmatchedNote(unmatched: string[]): string {
  if (unmatched.length === 0) return "";
  return `${plural(unmatched.length, "set", "sets")} could not be matched to the catalog, so nothing was asked about ${unmatched.length === 1 ? "it" : "them"}: ${unmatched.join(", ")}.`;
}

/* --- One set's products --------------------------------------------------- */

/**
 * Three states, not two.
 *
 * A kind a set does not sell and a kind whose price is missing are different
 * facts, and a single dash would merge them: "Booster Box — —" reads as a
 * failure for a set that has never had a booster box. Keeping them apart is v1's
 * judgement and it is the right one.
 */
export type KindState = "priced" | "unpriced" | "not-sold";

export interface KindCell {
  key: SealedKind;
  label: string;
  state: KindState;
  /** Present only when `state` is "priced". Never zero — see `Money`. */
  price: number | undefined;
  /** The product's own name upstream, so an odd match can be spotted. */
  productName: string;
}

/** Every tracked kind, in the order the model lists them, with what is known. */
export function kindCells(prices: readonly SealedPrice[]): KindCell[] {
  const byKind = new Map(prices.map((p) => [p.kind, p]));
  return SEALED_KINDS.map(({ key, label }) => {
    const found = byKind.get(key);
    if (!found) return { key, label, state: "not-sold" as const, price: undefined, productName: "" };
    return {
      key,
      label,
      state: found.price === undefined ? ("unpriced" as const) : ("priced" as const),
      price: found.price,
      productName: found.productName,
    };
  });
}

/** How many of the kinds a set actually sells came back with a price. */
export function pricedOf(cells: readonly KindCell[]): { offered: number; priced: number } {
  const offered = cells.filter((c) => c.state !== "not-sold").length;
  const priced = cells.filter((c) => c.state === "priced").length;
  return { offered, priced };
}

/**
 * What a row says about its own completeness, or "" when it is complete.
 *
 * Named rather than counted: "no price for Booster Box" is something a reader
 * can act on — go and look it up — where "1 unpriced" is a number about nothing.
 */
export function rowNote(cells: readonly KindCell[]): string {
  const unpriced = cells.filter((c) => c.state === "unpriced").map((c) => c.label);
  if (unpriced.length === 0) return "";
  return `No current price for ${unpriced.join(" or ")} — left blank rather than shown as zero.`;
}

/* --- How old the numbers are ---------------------------------------------- */

/**
 * The server's own cache window for a sealed reading (`sealedStore.TTL_MS`).
 *
 * Past this the server refreshes on the next request — and if that refresh
 * FAILS it deliberately keeps serving the old copy, forever, with the original
 * `updated` stamp. So a reading older than this window is by construction one
 * whose refresh did not succeed: it is yesterday's number, or last week's, and
 * a screen that shows it without saying so is lying about the only figure in
 * the app that is expected to move day to day.
 */
export const READING_TTL_MS = 20 * 60 * 60_000;

export interface PriceAge {
  /** "4 hr ago", "3d ago", "Sep 4, 2026". Counts against a real clock. */
  label: string;
  /** Older than the window the server refreshes on, so it must be said aloud. */
  stale: boolean;
}

export function priceAge(updated: string, now: number = Date.now()): PriceAge {
  const at = Date.parse(updated);
  if (!updated || Number.isNaN(at)) {
    // No usable stamp is the worst case, not the best: it could be any age.
    return { label: "an unknown time ago", stale: true };
  }
  return { label: formatUpdated(updated, now), stale: now - at > READING_TTL_MS };
}

/* --- The whole page ------------------------------------------------------- */

export interface ProductTally {
  /** Products the sets actually sell. */
  offered: number;
  /** Of those, how many have a current price. */
  priced: number;
}

/**
 * The honest denominator for the page.
 *
 * A grid of figures with four blanks in it looks like a grid of figures. This
 * is how many of the products on screen have a number at all, which is the
 * partial-state rule applied to a screen made entirely of prices.
 */
export function productTally(rows: ReadonlyArray<{ prices: readonly SealedPrice[] }>): ProductTally {
  let offered = 0;
  let priced = 0;
  for (const row of rows) {
    for (const cell of kindCells(row.prices)) {
      if (cell.state === "not-sold") continue;
      offered += 1;
      if (cell.state === "priced") priced += 1;
    }
  }
  return { offered, priced };
}

/** "38 of 41 products priced", or "" when there is nothing to qualify. */
export function tallyLine(tally: ProductTally): string {
  if (tally.offered === 0) return "";
  if (tally.priced === tally.offered) {
    return `All ${plural(tally.offered, "product", "products")} priced`;
  }
  return `${tally.priced} of ${plural(tally.offered, "product", "products")} priced`;
}
