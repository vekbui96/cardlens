import type { SyncStatus } from "../../../app/LibraryProvider.tsx";
import { syncLine } from "../../../features/collection/syncLine.ts";
import type { SetTiers } from "../../../models/setCompletion.ts";
import type { SetValue } from "../../../models/value.ts";

/**
 * The decisions Home makes, with no React around them.
 *
 * Everything here is a judgement about what to SAY, and every one of them has a
 * wrong answer that looks fine on a full collection and lies on a partial one.
 * Pulling them out means the lies can be asserted in a unit test rather than
 * noticed by whoever happens to open the app while the catalog is down.
 */

export interface PricingInput {
  /** Printings held. */
  printings: number;
  /** Of those, how many have a price. */
  priced: number;
  /**
   * Sets whose pricing query has not settled — as `useCollectionValue` counts
   * them, which includes queries that are DISABLED because the set has no name
   * yet. That is why `setsLoaded` and `setNames` are needed below.
   */
  pending: number;
  /** Sets whose pricing request failed outright. */
  failed: number;
  bySet: SetValue[];
  setNames: Record<string, string>;
  /**
   * Whether the set list itself has arrived. Until it has, a set with no name
   * is a set we have not been told about yet, not a set that cannot be priced.
   */
  setsLoaded: boolean;
}

export interface PricingSummary {
  /** Pass to `Money`. True only when there is no total to show yet. */
  loading: boolean;
  /** The line under the total. Never absent — a bare total is never honest. */
  line: string;
  /** The line reports a problem rather than progress. */
  warn: boolean;
  /** Sets genuinely still in flight, disabled queries excluded. */
  waiting: number;
  /** Sets nothing could price, by display name. Named, never silently dropped. */
  cannotPrice: string[];
  /** A retry would do something. */
  retryable: boolean;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * What to say beside the total.
 *
 * The rule the screen exists to keep: the total is only ever shown next to how
 * much of the collection it covers. 973 printings priced down to 480 of them is
 * a number roughly half as big as it looks, and a headline with no denominator
 * gives no way to tell that from a collection that halved in value.
 *
 * The second thing it fixes is a "pricing…" that never ends. `useCollectionValue`
 * counts a DISABLED query as pending, and a set's query is disabled while its
 * name is unknown — so a failed set list leaves every set held permanently
 * "pricing", and the screen waits forever for something nobody is fetching.
 * Once the set list has arrived, a set that is not in it cannot be priced at
 * all, and this says so instead.
 */
export function pricingSummary(input: PricingInput): PricingSummary {
  const { printings, priced, pending, failed, bySet, setNames, setsLoaded } = input;

  if (printings === 0) {
    return {
      loading: false,
      line: "Nothing to price yet",
      warn: false,
      waiting: 0,
      cannotPrice: [],
      retryable: false,
    };
  }

  const unknown = setsLoaded ? bySet.filter((s) => !setNames[s.setId]) : [];
  const waiting = Math.max(0, pending - unknown.length);

  // A set with nothing priced is only "cannot price" once nothing is still
  // coming for it — otherwise this would accuse the catalog mid-request.
  const cannotPrice = bySet
    .filter((s) => s.priced === 0 && (waiting === 0 || unknown.includes(s)))
    .map((s) => setNames[s.setId] ?? s.setId);

  const loading = priced === 0 && waiting > 0;
  const retryable = cannotPrice.length > 0 || failed > 0;

  if (waiting > 0) {
    const tail = `${waiting} ${plural(waiting, "set", "sets")} still pricing`;
    return {
      loading,
      line:
        priced === 0
          ? `Pricing ${waiting} ${plural(waiting, "set", "sets")}…`
          : `${priced} of ${printings} printings priced · ${tail}`,
      warn: false,
      waiting,
      cannotPrice,
      retryable,
    };
  }

  if (priced === 0) {
    return {
      loading: false,
      line: `No prices for any of your ${printings} printings`,
      warn: true,
      waiting: 0,
      cannotPrice,
      retryable: true,
    };
  }

  return {
    loading: false,
    line:
      priced === printings
        ? `All ${printings} printings priced`
        : `${priced} of ${printings} printings priced`,
    warn: false,
    waiting: 0,
    cannotPrice,
    retryable,
  };
}

/**
 * The figure a set's row shows, and the bar it draws.
 *
 * BASE where the set has a base tier, master otherwise — the same rule
 * `topProgress` ranks on. The two have to agree: a list ordered by how close a
 * set is to its base tier, drawing a master bar, would put a set at the top
 * showing 40%, and the row would look like a sorting bug.
 */
export function completionFigure(tiers: SetTiers, owned: number): { ratio: number; text: string } {
  if (tiers.baseTotal !== undefined) {
    return { ratio: tiers.baseRatio ?? 0, text: `${tiers.baseOwned} / ${tiers.baseTotal} base` };
  }
  if (tiers.masterTotal !== undefined) {
    return { ratio: tiers.masterRatio ?? 0, text: `${tiers.masterOwned} / ${tiers.masterTotal}` };
  }
  // The set's size is unknown, so there is no denominator to divide by. NaN
  // rather than 0 — `Meter` treats a non-finite ratio as "there is nothing to
  // have", which is the truth here, where 0 would say "you have none of it".
  return { ratio: Number.NaN, text: `${owned} ${plural(owned, "card", "cards")}` };
}

export interface SyncNotice {
  /** The shared wording, so Home and the shell cannot describe sync differently. */
  label: string;
  /** What it means here, and what is still safe. Home's own words — see below. */
  detail: string;
}

/**
 * Sync, but only when sync needs a person.
 *
 * The shell already prints `syncLine`'s label on every screen, Home included.
 * Repeating it in the page would spend the largest surface in the app on a
 * status that is correct and needs nothing — and would train the reader to skip
 * the row on the two occasions it matters.
 *
 * Those two are the ones that stay broken until someone acts: a token the server
 * rejected, and a server with sync switched off. Everything else — off, idle,
 * syncing, offline — either recovers by itself or was chosen deliberately, and
 * the shell's label is the right size for it.
 *
 * The wording is Home's rather than `syncLine`'s hint because those hints are
 * written for the glasses ("Select to re-enter", "← to disconnect") and describe
 * gestures a browser does not have. The LABEL is shared, so the two versions
 * cannot disagree about what the state is called.
 */
export function syncNotice(status: SyncStatus): SyncNotice | null {
  switch (status.state) {
    case "bad-token":
      return {
        label: syncLine(status).label,
        detail:
          "The server would not accept this device's sync token. Everything you mark is still saved here; open Collection to enter it again.",
      };
    case "disabled":
      return {
        label: syncLine(status).label,
        detail:
          "This server has collection sync switched off, so there is nothing to sync with. Everything you mark is still saved on this device.",
      };
    default:
      return null;
  }
}
