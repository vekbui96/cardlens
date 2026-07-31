import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import {
  mergePrintings,
  pruneTombstones,
  rowStamp,
  type OwnedPrinting,
} from "../src/storage/printings.ts";

/**
 * Server-side collection store: the sync hub between devices.
 *
 * Deliberately NOT a database. The whole dataset is a few thousand tiny rows
 * read and written wholesale, and the only durability requirement is surviving
 * a power cut mid-write — which write-temp → fsync → rename already gives on
 * NTFS. A native SQLite module would add a Windows build toolchain to a
 * headless box for no benefit at this size.
 *
 * The merge rule is imported from the client's printings.ts rather than
 * reimplemented: two copies of a convergence rule that drift is exactly how a
 * sync system starts losing data.
 */

/** Rejects absurd payloads on a publicly reachable endpoint. */
export const MAX_ROWS_PER_REQUEST = 50_000;

/**
 * Finishes are `type` or `type:foil` keys and CANNOT be an allow-list: sets
 * keep inventing foils (pokeball, masterball, tinsel, cosmos, energy,
 * friendball, loveball, quickball, team-rocket across three 2025-26 sets
 * alone), and a finish the client can mark but the server rejects is silently
 * dropped on sync — data loss that looks like nothing happened.
 *
 * So validate the SHAPE and bound the length instead.
 */
const FINISH_PATTERN = /^[A-Za-z][A-Za-z0-9-]{0,29}(:[A-Za-z0-9-]{1,29})?$/;

/**
 * Validate an untrusted row. The endpoint is on the public internet, so a
 * malformed or hostile row must be dropped rather than persisted — one bad
 * `at` of Infinity would win every future merge for that card, permanently.
 */
export function parseRow(value: unknown): OwnedPrinting | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;

  if (typeof v.cardId !== "string" || !v.cardId || v.cardId.length > 100) return null;
  if (typeof v.setId !== "string" || !v.setId || v.setId.length > 100) return null;
  if (typeof v.finish !== "string" || !FINISH_PATTERN.test(v.finish)) return null;
  if (typeof v.at !== "number" || !Number.isFinite(v.at) || v.at < 0) return null;
  if (v.deletedAt !== undefined) {
    if (typeof v.deletedAt !== "number" || !Number.isFinite(v.deletedAt) || v.deletedAt < 0) return null;
  }

  return {
    cardId: v.cardId,
    setId: v.setId,
    finish: v.finish,
    at: v.at,
    ...(typeof v.deletedAt === "number" ? { deletedAt: v.deletedAt } : {}),
  };
}

export class CollectionStore {
  private rows: OwnedPrinting[] = [];

  constructor(private readonly filePath: string) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, "utf8"));
      this.rows = Array.isArray(parsed) ? parsed.flatMap((r) => parseRow(r) ?? []) : [];
    } catch {
      // A corrupt file must not stop the service booting. Devices still hold
      // their own copies, so the next sync repopulates this.
      console.warn(`[cardlens] collection file unreadable at ${this.filePath} — starting empty`);
      this.rows = [];
    }
  }

  /**
   * Write to a temp file, flush it to disk, then rename over the target.
   * Rename is atomic, so a power cut leaves either the old file or the new one
   * — never a half-written one.
   */
  private persist(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    const fd = openSync(tmp, "w");
    try {
      writeSync(fd, JSON.stringify(this.rows));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, this.filePath);
  }

  all(): OwnedPrinting[] {
    return this.rows;
  }

  /**
   * Rows written after `ts`. Comparison is inclusive-exclusive by watermark, so
   * a client that stores the returned `at` and sends it back next time sees
   * every change exactly once.
   */
  since(ts: number): OwnedPrinting[] {
    return this.rows.filter((r) => rowStamp(r) > ts);
  }

  /** Merge incoming rows, persist, and return the full converged set. */
  merge(incoming: OwnedPrinting[]): OwnedPrinting[] {
    this.rows = pruneTombstones(mergePrintings(this.rows, incoming));
    this.persist();
    return this.rows;
  }
}
