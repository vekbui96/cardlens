import { canonicalFinish } from "./finishes.ts";
import {
  isBinderFormat,
  isTradeCondition,
  MAX_SLOT_QUANTITY,
  specFor,
  type Binder,
  type BinderPage,
  type BinderSlot,
} from "./binderLayout.ts"; /**
 * Validation for a binder that arrived from somewhere else.
 *
 * Shared by the server, which decides what may be STORED when a device pushes,
 * and by the trade-share screen, which decides what may be DRAWN when a
 * stranger opens a link. Those are different jobs with the same answer, and the
 * codebase already has the argument for not writing it twice — see
 * storage/binders.ts on why the merge rule is imported rather than
 * reimplemented. A validator that drifts fails the same way: the two ends
 * disagree about what a binder is and a pocket silently vanishes at one of them.
 *
 * Every function here is PURE and touches no filesystem, which is what lets the
 * browser bundle it. The server's binderStore.ts re-exports these so its own
 * callers and tests are unaffected.
 *
 * It is a WHITELIST. A field a client can write must be named here or it
 * silently vanishes on sync — a trap that has already cost this codebase two
 * bugs (`excluded` on the collection, twice) — so the fields are listed against
 * models/binderLayout.ts rather than from memory.
 */

/** Bounds on a publicly reachable endpoint. Generous against real use, absurd against abuse. */
export const MAX_BINDERS_PER_REQUEST = 500;
export const MAX_PAGES = 400;
export const MAX_NAME = 120;
export const MAX_LABEL = 120;
/**
 * An image is referenced by id or by URL, never carried inline. A data URI
 * would be tens of thousands of characters and would be pushed again on every
 * single edit to the binder holding it — see the image store for where the
 * bytes actually go.
 */
export const MAX_SRC = 512;
export const MAX_ID = 64;

/**
 * A stored image id: random stem, known extension, nothing else.
 *
 * This is the whole path defence for server/binderImages.ts. The id goes
 * straight into a filename, so the pattern admits no slash, no dot beyond the
 * extension separator, and no traversal — `..jpg` fails the 8-character minimum
 * stem. It lives here rather than beside that store because the validator and
 * the store both need it, and an id one accepts while the other refuses to
 * serve is a permanently broken pocket.
 */
export const IMAGE_ID_PATTERN = /^[A-Za-z0-9_-]{8,48}\.(jpg|png|webp)$/;
const FINISH_PATTERN = /^[A-Za-z][A-Za-z0-9-]{0,29}(:[A-Za-z0-9-]{1,29})?$/;

function str(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

function stamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Copies behind a pocket, clamped to the range a pocket can mean.
 *
 * Clamped rather than rejected. This runs on a payload a device wrote, not on
 * user input being validated at a form — the card and its position are the
 * valuable part, and refusing the slot outright over a count would silently
 * empty a pocket that has a perfectly good card in it.
 */
export function parseQuantity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.min(MAX_SLOT_QUANTITY, Math.max(1, Math.floor(value)));
}

/** Validate one pocket. */
export function parseSlot(value: unknown): BinderSlot | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;

  if (v.kind === "card") {
    const cardId = str(v.cardId, 100);
    const finish = str(v.finish, 40);
    if (!cardId || !finish || !FINISH_PATTERN.test(finish)) return null;
    const copies = parseQuantity(v.quantity);
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
      // Trade fields. Both are OPTIONAL and both are dropped when they do not
      // parse, rather than failing the whole slot: a bad quantity should cost
      // the count, not the card.
      //
      // A quantity of 1 is not stored, matching withQuantity in binderLayout —
      // so a client that sends 1 and one that sends nothing converge on the
      // same bytes and cannot ping-pong through last-write-wins.
      ...(copies > 1 ? { quantity: copies } : {}),
      ...(isTradeCondition(v.condition) ? { condition: v.condition } : {}),
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

export function parsePage(value: unknown, pockets: number): BinderPage | null {
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
 * Validate an untrusted binder. Returns null to DROP it — the sync route counts
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
  if (!isBinderFormat(v.format)) return null;
  if (v.deletedAt !== undefined && stamp(v.deletedAt) === null) return null;
  if (!Array.isArray(v.pages) || v.pages.length > MAX_PAGES) return null;

  const pockets = specFor(v.format).pockets;
  return {
    id,
    name,
    format: v.format,
    // Only `true` is stored, so a binder taken off trade is byte-identical to
    // one never on it — same reason quantity 1 is not stored.
    ...(v.forTrade === true ? { forTrade: true } : {}),
    ...(v.showValue === true ? { showValue: true } : {}),
    pages: v.pages.flatMap((p) => parsePage(p, pockets) ?? []),
    createdAt,
    updatedAt,
    ...(typeof v.deletedAt === "number" ? { deletedAt: v.deletedAt } : {}),
  };
}
