import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import { Router, type RequestHandler } from "express";
import type { Printing } from "../src/integrations/tcgdex/client.ts";
import { buildPrintingIndex } from "../src/models/printingIndex.ts";
import { collectorNumberFromCardId, marketPrice } from "../src/models/marketPrice.ts";
import { valueCollection } from "../src/models/value.ts";
import { gamePrintings, livePrintings, type OwnedPrinting } from "../src/storage/printings.ts";

/**
 * Collection value over time: one row a day, written by this server (#112).
 *
 * Decided in docs/decisions/value-history.md (option A, accepted 2026-11-22).
 * The server writes it rather than the devices because Ve opens Home a few
 * days a month, and a row only on those days could never draw a trend.
 *
 * NEW STORED DATA, kept forever, so it gets the same care as the collection:
 * - its own file (`value-history.json` beside the collection), its own
 *   validator, and nothing here reads or writes the collection, binders,
 *   shares or metrics;
 * - writes go temp -> fsync -> rename, so a power cut leaves the old file or
 *   the new one, never half of one;
 * - the file carries a version, and a file this code cannot read (corrupt, or a
 *   version from the future) is NEVER overwritten: the store goes read-only
 *   and says so, rather than replacing history it did not understand;
 * - no retention trim. A row is ~110 bytes, ~40 KB a year. `MAX_ROWS` is a
 *   guard against a runaway writer, not a retention policy.
 */

export const VALUE_HISTORY_VERSION = 1;
/** Ten years of days. Past it the oldest rows go, which is a bug signal, not a plan. */
export const MAX_ROWS = 3650;
/** Home's total is TCGplayer market USD; so is every row. */
export const VALUE_CURRENCY = "USD";

export interface ValueRow {
  /** Local calendar day on the server, `YYYY-MM-DD`. One row per day. */
  day: string;
  /** USD. Only priced printings contribute. */
  total: number;
  /** Of `printings`, how many had a price. `0` = a gap, never interpolated. */
  priced: number;
  /** Live printings held (the collection as synced to this server). */
  printings: number;
  /** Distinct cards held. */
  cards: number;
  currency: string;
  /** Epoch ms when the row was computed. */
  at: number;
}

export interface ValueHistoryFile {
  version: typeof VALUE_HISTORY_VERSION;
  rows: ValueRow[];
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

/** One row, or null when anything about it is off. Unknown fields are dropped. */
export function parseValueRow(raw: unknown): ValueRow | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { day, total, priced, printings, cards, currency, at } = raw as Record<string, unknown>;
  if (typeof day !== "string" || !DAY_RE.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`)))
    return null;
  if (!isCount(total) || !isCount(priced) || !isCount(printings) || !isCount(cards) || !isCount(at))
    return null;
  if (!Number.isInteger(priced) || !Number.isInteger(printings) || !Number.isInteger(cards)) return null;
  if (priced > printings) return null;
  if (typeof currency !== "string" || currency.length === 0) return null;
  return { day, total, priced, printings, cards, currency, at };
}

export type ParsedHistory =
  { ok: true; file: ValueHistoryFile; dropped: number } | { ok: false; reason: string };

/**
 * Read a whole file. A known version with a few bad rows keeps the good ones
 * (and reports how many went); anything else is refused outright.
 */
export function parseValueHistory(raw: unknown): ParsedHistory {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return { ok: false, reason: "not an object" };
  const { version, rows } = raw as Record<string, unknown>;
  if (version !== VALUE_HISTORY_VERSION) return { ok: false, reason: `unknown version ${String(version)}` };
  if (!Array.isArray(rows)) return { ok: false, reason: "rows is not an array" };
  const byDay = new Map<string, ValueRow>();
  let dropped = 0;
  for (const r of rows) {
    const row = parseValueRow(r);
    if (!row) {
      dropped += 1;
      continue;
    }
    const existing = byDay.get(row.day);
    if (existing) dropped += 1;
    if (!existing || betterRow(row, existing)) byDay.set(row.day, row);
  }
  return { ok: true, file: { version: VALUE_HISTORY_VERSION, rows: sortRows([...byDay.values()]) }, dropped };
}

function sortRows(rows: ValueRow[]): ValueRow[] {
  return rows.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/**
 * Whether `next` should replace `current` for the same day: only with strictly
 * better coverage. A later run that met an upstream burst and priced less must
 * not overwrite a good morning row, and an equal run adds nothing.
 */
export function betterRow(next: ValueRow, current: ValueRow): boolean {
  return next.priced > current.priced;
}

/** Add or replace today's row under the rules above. Pure. */
export function upsertRow(rows: ValueRow[], row: ValueRow): { rows: ValueRow[]; changed: boolean } {
  const i = rows.findIndex((r) => r.day === row.day);
  if (i >= 0) {
    if (!betterRow(row, rows[i] as ValueRow)) return { rows, changed: false };
    const next = rows.slice();
    next[i] = row;
    return { rows: next, changed: true };
  }
  const next = sortRows([...rows, row]);
  return { rows: next.length > MAX_ROWS ? next.slice(next.length - MAX_ROWS) : next, changed: true };
}

export class ValueHistoryStore {
  private rows: ValueRow[] = [];
  /** Set when the file on disk could not be understood. Nothing is written then. */
  readonly readOnlyReason: string | null = null;

  constructor(private readonly filePath: string) {
    if (!existsSync(filePath)) return;
    let parsed: ParsedHistory;
    try {
      parsed = parseValueHistory(JSON.parse(readFileSync(filePath, "utf8")));
    } catch (err) {
      parsed = { ok: false, reason: `unreadable (${String(err)})` };
    }
    if (parsed.ok) {
      this.rows = parsed.file.rows;
      if (parsed.dropped > 0) console.warn(`[cardlens] value history: ignored ${parsed.dropped} bad row(s)`);
    } else {
      this.readOnlyReason = parsed.reason;
      console.warn(
        `[cardlens] value history at ${filePath} is ${parsed.reason}; leaving it untouched and recording nothing`,
      );
    }
  }

  all(): ValueRow[] {
    return this.rows;
  }

  has(day: string): ValueRow | undefined {
    return this.rows.find((r) => r.day === day);
  }

  /** Record a row. Returns whether the file changed. Never throws. */
  record(row: ValueRow): boolean {
    if (this.readOnlyReason) return false;
    const valid = parseValueRow(row);
    if (!valid) return false;
    const { rows, changed } = upsertRow(this.rows, valid);
    if (!changed) return false;
    try {
      this.persist({ version: VALUE_HISTORY_VERSION, rows });
      this.rows = rows;
      return true;
    } catch (err) {
      console.warn(`[cardlens] value history write failed:`, err);
      return false;
    }
  }

  private persist(file: ValueHistoryFile): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    const fd = openSync(tmp, "w");
    try {
      writeSync(fd, JSON.stringify(file));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, this.filePath);
  }
}

/** The server's local calendar day. Ve and the box share a time zone. */
export function localDay(now: number): string {
  const d = new Date(now);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export interface ValuationSources {
  /** TCGdex printings for a set (`byNumber`), or null when unavailable. */
  printings(setId: string): Promise<Record<string, Printing[]> | null>;
  /** The pokemontcg.io price index for a set (`cardId|priceKey` -> USD), or null. */
  catalogPrices(setId: string): Promise<Record<string, number> | null>;
}

export interface Valuation {
  row: ValueRow;
  /** Sets where at least one source failed: the row is worth retrying later. */
  failedSets: number;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * What the synced collection is worth today, by the SAME rule Home uses:
 * TCGdex's price for the printing, else pokemontcg.io's (`marketPrice`), summed
 * by `valueCollection`. Both are shared with the client so the chart and the
 * headline cannot become two answers to one question.
 */
export async function valueSyncedCollection(
  allRows: OwnedPrinting[],
  sources: ValuationSources,
  now: number,
): Promise<Valuation> {
  const rows = livePrintings(gamePrintings(allRows)).map((r) => ({
    cardId: r.cardId,
    setId: r.setId || r.cardId.slice(0, r.cardId.lastIndexOf("-")),
    finish: r.finish,
  }));
  const setIds = [...new Set(rows.map((r) => r.setId))].sort();
  let failedSets = 0;

  const perSet = await mapLimit(setIds, 4, async (setId) => {
    const [printings, catalog] = await Promise.all([
      sources.printings(setId).catch(() => null),
      sources.catalogPrices(setId).catch(() => null),
    ]);
    if (printings === null || catalog === null) failedSets += 1;
    return { setId, index: buildPrintingIndex(printings), catalog };
  });

  const indexes = new Map(perSet.map((s) => [s.setId, s.index]));
  const catalog = new Map<string, number>();
  for (const s of perSet) for (const [k, v] of Object.entries(s.catalog ?? {})) catalog.set(k, v);

  const value = valueCollection(rows, (row) =>
    marketPrice(
      indexes.get(row.setId),
      catalog,
      row.cardId,
      collectorNumberFromCardId(row.cardId),
      row.finish,
    ),
  );

  return {
    row: {
      day: localDay(now),
      total: Math.round(value.total * 100) / 100,
      priced: value.priced,
      printings: value.printings,
      cards: new Set(rows.map((r) => r.cardId)).size,
      currency: VALUE_CURRENCY,
      at: now,
    },
    failedSets,
  };
}

/**
 * The daily job: on boot, then hourly. A day is finished once it has a row and
 * the run behind it had every source answer; until then each hourly check
 * tries again, and only a better-covered row replaces the earlier one.
 */
export class ValueHistoryJob {
  private finishedDay: string | null = null;
  private running = false;

  constructor(
    private readonly store: ValueHistoryStore,
    private readonly collection: () => OwnedPrinting[],
    private readonly sources: ValuationSources,
    private readonly clock: () => number = Date.now,
  ) {}

  async tick(): Promise<"skipped" | "recorded" | "unchanged" | "empty"> {
    if (this.running || this.store.readOnlyReason) return "skipped";
    const now = this.clock();
    const day = localDay(now);
    if (this.finishedDay === day) return "skipped";
    this.running = true;
    try {
      const rows = this.collection();
      if (livePrintings(gamePrintings(rows)).length === 0) return "empty";
      const { row, failedSets } = await valueSyncedCollection(rows, this.sources, now);
      const recorded = this.store.record(row);
      if (failedSets === 0 && row.priced > 0) this.finishedDay = day;
      console.log(
        `[cardlens] value history ${day}: $${row.total} from ${row.priced}/${row.printings} priced` +
          `${failedSets ? `, ${failedSets} set(s) failed` : ""} — ${recorded ? "recorded" : "kept earlier row"}`,
      );
      return recorded ? "recorded" : "unchanged";
    } catch (err) {
      console.warn(`[cardlens] value history run failed:`, err);
      return "skipped";
    } finally {
      this.running = false;
    }
  }

  /** First run shortly after boot (not during it), then hourly. Timers never hold the process open. */
  start(firstDelayMs = 60_000, everyMs = 60 * 60_000): void {
    setTimeout(() => void this.tick(), firstDelayMs).unref();
    setInterval(() => void this.tick(), everyMs).unref();
  }
}

/** `GET /api/value-history`: read-only, behind the sync token. */
export function valueHistoryRouter(
  store: ValueHistoryStore,
  opts: { auth: RequestHandler; limiter: RequestHandler },
): Router {
  const router = Router();
  router.get("/api/value-history", opts.limiter, opts.auth, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const body: ValueHistoryFile = { version: VALUE_HISTORY_VERSION, rows: store.all() };
    res.json(body);
  });
  return router;
}
