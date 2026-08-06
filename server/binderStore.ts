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
import { canonicalFinish } from "../src/models/finishes.ts";
import {
  binderStamp,
  mergeBinders,
  pruneBinderTombstones,
  referencedImageIds,
} from "../src/storage/binders.ts";
import { specFor, type Binder, type BinderPage, type BinderSlot } from "../src/models/binderLayout.ts";
// The one pattern, shared with the store that names the files: an id this
// accepts but the image store refuses to serve is a permanently broken pocket.
import { IMAGE_ID_PATTERN } from "./binderImages.ts";

/**
 * Server-side binder store: the sync hub for hand-laid-out binders.
 *
 * Same shape and the same durability story as CollectionStore — a small JSON
 * file written temp → fsync → rename — and the same rule about the merge: it is
 * imported from the client's storage/binders.ts, never reimplemented here.
 *
 * Kept in its own file rather than folded into the collection, because the two
 * converge differently. The collection is an OR-Set of independent facts; a
 * binder is one artefact that last-write-wins. Sharing a file would invite
 * sharing a merge rule, which is the mistake.
 */

/** Bounds on a publicly reachable endpoint. Generous against real use, absurd against abuse. */
export const MAX_BINDERS_PER_REQUEST = 500;
const MAX_PAGES = 400;
const MAX_NAME = 120;
const MAX_LABEL = 120;
/**
 * An image is referenced by id or by URL, never carried inline. A data URI
 * would be tens of thousands of characters and would be pushed again on every
 * single edit to the binder holding it — see the image store for where the
 * bytes actually go.
 */
const MAX_SRC = 512;
const MAX_ID = 64;
const FINISH_PATTERN = /^[A-Za-z][A-Za-z0-9-]{0,29}(:[A-Za-z0-9-]{1,29})?$/;

function str(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

function stamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Validate one pocket.
 *
 * A whitelist, like parseRow — so every field a client can write MUST be named
 * here or it silently vanishes on sync. That trap has already cost this
 * codebase two bugs (`excluded` on the collection, twice over), so the fields
 * are listed against models/binderLayout.ts rather than from memory.
 */
export function parseSlot(value: unknown): BinderSlot | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;

  if (v.kind === "card") {
    const cardId = str(v.cardId, 100);
    const finish = str(v.finish, 40);
    if (!cardId || !finish || !FINISH_PATTERN.test(finish)) return null;
    return {
      kind: "card",
      cardId,
      // Canonicalised on ingest, matching the collection: a binder pocket is
      // matched against owned rows by (cardId, finish), and a raw "holofoil"
      // here would render an owned card as one you do not have.
      finish: canonicalFinish(finish),
      ...(str(v.name, MAX_NAME) ? { name: v.name as string } : {}),
      ...(str(v.imageSmall, MAX_SRC) ? { imageSmall: v.imageSmall as string } : {}),
      ...(str(v.collectorNumber, 20) ? { collectorNumber: v.collectorNumber as string } : {}),
    };
  }

  if (v.kind === "image") {
    const imageId = str(v.imageId, MAX_ID);
    const src = str(v.src, MAX_SRC);
    // One or the other must resolve to something renderable; a slot with
    // neither is a grey box nobody asked for.
    if (imageId && !IMAGE_ID_PATTERN.test(imageId)) return null;
    if (!imageId && !src) return null;
    return {
      kind: "image",
      ...(imageId ? { imageId } : {}),
      ...(src ? { src } : {}),
      ...(str(v.label, MAX_LABEL) ? { label: v.label as string } : {}),
    };
  }

  return null;
}

function parsePage(value: unknown, pockets: number): BinderPage | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = (value as { slots?: unknown }).slots;
  if (typeof raw !== "object" || raw === null) return null;

  const slots: Record<number, BinderSlot> = {};
  for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
    const index = Number(key);
    // Out-of-range pockets are dropped rather than clamped: a slot at index 11
    // in a 9-pocket binder has no position, and moving it to one would put a
    // card somewhere the user never placed it.
    if (!Number.isInteger(index) || index < 0 || index >= pockets) continue;
    const slot = parseSlot(entry);
    if (slot) slots[index] = slot;
  }
  return { slots };
}

/**
 * Validate an untrusted binder. Returns null to DROP it — the route counts
 * those and reports the number, because a binder that vanishes on sync with no
 * signal is the silent-failure shape this codebase keeps being bitten by.
 */
export function parseBinder(value: unknown): Binder | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;

  const id = str(v.id, MAX_ID);
  const name = str(v.name, MAX_NAME);
  const createdAt = stamp(v.createdAt);
  const updatedAt = stamp(v.updatedAt);
  if (!id || !name || createdAt === null || updatedAt === null) return null;
  if (v.format !== "9" && v.format !== "12") return null;
  if (v.deletedAt !== undefined && stamp(v.deletedAt) === null) return null;
  if (!Array.isArray(v.pages) || v.pages.length > MAX_PAGES) return null;

  const pockets = specFor(v.format).pockets;
  return {
    id,
    name,
    format: v.format,
    pages: v.pages.flatMap((p) => parsePage(p, pockets) ?? []),
    createdAt,
    updatedAt,
    ...(typeof v.deletedAt === "number" ? { deletedAt: v.deletedAt } : {}),
  };
}

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
