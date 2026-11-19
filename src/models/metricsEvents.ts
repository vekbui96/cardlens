/**
 * The usage metrics vocabulary — every event name a device may count and the
 * server may store.
 *
 * Shared with the server through `tsconfig.node.json`, the same way the merge
 * rules are: the device decides what it counts and the server decides what it
 * keeps, and two lists that drift would mean a counter that is collected on
 * every phone and silently thrown away at the far end.
 *
 * **Names only, never values that identify anything.** No card ids, set ids,
 * binder names, queries or tokens appear here or anywhere in a metrics payload:
 * each event is a fixed string and its value is a count. That is the whole
 * privacy model, so it is enforced by the server refusing any name not listed.
 */

/** Every screen the router knows. Kept in step with `ScreenName` by a compile-time check in services/metrics.ts. */
export const METRIC_SCREENS = [
  "home",
  "results",
  "details",
  "favorites",
  "recent",
  "popular",
  "sets",
  "set",
  "collection",
  "owned",
  "sealed",
  "target",
  "scan",
  "showcase",
  "live",
  "binders",
  "binder",
  "trade",
  "workshop",
] as const;

export const METRIC_EVENTS = [
  // --- Scanning. Recognition outcome, counted when a capture settles. -------
  /** The recogniser was confident and pre-chose candidate 0. */
  "scan.accepted",
  /** Candidates came back, none confident enough to auto-accept. */
  "scan.ambiguous",
  /** Nothing came back that could be offered. */
  "scan.unknown",
  /** Which recogniser answered that capture. */
  "scan.via.server",
  "scan.via.device",
  /** An uploaded photo, answered by the photo engine (Mault) behind /api/cards/identify. */
  "scan.via.mault",
  /**
   * A camera capture phash could not settle, answered by Mault too (its
   * native-resolution guide crop). Counted beside scan.via.server/device.
   */
  "scan.via.camera_mault",
  /** ...and Mault confirmed one of phash's candidates, settling the row. */
  "scan.camera_mault.confirmed",
  // --- Scanning. Resolution, counted when a batch is committed. -------------
  /** Batches committed ("Add N"). */
  "scan.batch",
  /** Rows filed across those batches — batch size is this over scan.batch. */
  "scan.batch.cards",
  /** Rows the reviewer rejected. */
  "scan.batch.rejected",
  /** Filed rows that were named by hand through "Pick by set". */
  "scan.manual_pick",
  /** Filed rows where the recogniser had been confident and the reviewer filed a different card. */
  "scan.corrected",

  // --- Sync, one count per run. ----------------------------------------------
  "sync.ok",
  /** Network error or timeout: the server never answered. */
  "sync.fail.offline",
  /** The server answered with an error status. */
  "sync.fail.http",
  /** 413 — the payload was refused as too large. */
  "sync.fail.too_large",
  "sync.bad_token",
  "sync.disabled",
  /** Rows the server refused as invalid during a merge (its `dropped`). */
  "sync.dropped_rows",
  /** Binders the server refused as invalid during a merge. */
  "sync.dropped_binders",

  // --- Usage. -----------------------------------------------------------------
  /** One per app load, by interaction model. */
  "layout.glasses",
  "layout.web",
  "layout.preview",
  "ui.v1",
  "ui.v2",
  ...METRIC_SCREENS.map((s) => `screen.${s}` as const),
  "binder.created",
  "binder.edited",
  "binder.deleted",
  "trade_link.minted",
  "share.created",
  /** Home's value settled; with the two below, priced/total coverage across loads. */
  "home.load",
  "home.priced",
  "home.printings",
] as const;

export type MetricEvent = (typeof METRIC_EVENTS)[number];

const KNOWN = new Set<string>(METRIC_EVENTS);

export function isMetricEvent(name: unknown): name is MetricEvent {
  return typeof name === "string" && KNOWN.has(name);
}

/** UTC calendar day, `YYYY-MM-DD`. Buckets are by UTC day on both ends so they always agree. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}
