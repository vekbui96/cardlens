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
import {
  binderStamp,
  mergeBinders,
  pruneBinderTombstones,
  referencedImageIds,
} from "../src/storage/binders.ts";
import type { Binder } from "../src/models/binderLayout.ts";

/**
 * Server-side binder store: the sync hub for hand-laid-out binders.
 *
 * Same shape and the same durability story as CollectionStore — a small JSON
 * file written temp → fsync → rename — and the same rule about the merge: it is
 * imported from the client's storage/binders.ts, never reimplemented here.
 *
 * The VALIDATION is imported for the same reason and now lives in
 * src/models/binderParse.ts, because the trade-share screen has to decide what
 * may be drawn from a link using exactly the rules this uses to decide what may
 * be stored. Re-exported below so this file stays the one import site for
 * callers and tests.
 *
 * Kept in its own file rather than folded into the collection, because the two
 * converge differently. The collection is an OR-Set of independent facts; a
 * binder is one artefact that last-write-wins. Sharing a file would invite
 * sharing a merge rule, which is the mistake.
 */
import { parseBinder } from "../src/models/binderParse.ts";

export { MAX_BINDERS_PER_REQUEST, parseBinder, parseSlot } from "../src/models/binderParse.ts";
export class BinderStore {
  private binders: Binder[] = [];

  constructor(private readonly filePath: string) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, "utf8"));
      this.binders = Array.isArray(parsed) ? parsed.flatMap((b) => parseBinder(b) ?? []) : [];
    } catch {
      // A corrupt file must not stop the service booting. Devices hold their
      // own copies, so the next sync repopulates this.
      console.warn(`[cardlens] binder file unreadable at ${this.filePath} — starting empty`);
      this.binders = [];
    }
  }

  /** Temp → fsync → rename, so a power cut leaves the old file or the new one, never half of one. */
  private persist(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    const fd = openSync(tmp, "w");
    try {
      writeSync(fd, JSON.stringify(this.binders));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, this.filePath);
  }

  all(): Binder[] {
    return this.binders;
  }

  /** Binders written after `ts` — tombstones included, or deletions never travel. */
  since(ts: number): Binder[] {
    return this.binders.filter((b) => binderStamp(b) > ts);
  }

  /** Merge incoming binders, persist, and return the full converged set. */
  merge(incoming: Binder[]): Binder[] {
    this.binders = pruneBinderTombstones(mergeBinders(this.binders, incoming));
    this.persist();
    return this.binders;
  }

  /** Image ids some live binder still points at. */
  referencedImages(): Set<string> {
    return referencedImageIds(this.binders);
  }
}
