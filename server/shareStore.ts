import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";

/**
 * Live shares — a set's progress, or a binder offered for trade.
 * * `models/showcase.ts` deliberately put the data IN the link so nothing was
 * ever uploaded and no id could be guessed. A live share cannot do that — the
 * whole point is that the page re-reads the collection after it was sent — so
 * this rebuilds the thing that was avoided, and has to answer the objections
 * that decision listed:
 *
 * - **Guessing**: ids are 16 random bytes, base64url. Not derived from the set
 *   id, the owner or the clock, so knowing one tells you nothing about another.
 * - **Revocation**: a share can be turned off, which a snapshot link never
 *   could — once pasted, that data was out forever.
 * - **Scope**: a share names ONE subject — a set, or a binder. It is not a key
 *   to the collection, and holding a link to one reveals nothing about another. *
 * What it still cannot do is un-send what someone already saw. Revoking stops
 * future reads; it does not retract a screenshot.
 */
interface ShareBase {
  id: string;
  createdAt: number;
  /** Present means the link is dead. Kept, not deleted, so the id is never reissued. */
  revokedAt?: number;
}

/** One set, priced and drawn against the owner's collection. */
export interface SetShare extends ShareBase {
  kind: "set";
  setId: string;
  setName: string;
}

/**
 * One binder, laid out as its owner arranged it — the trade list.
 *
 * A second kind rather than a second store, because everything that makes a
 * share safe is about the LINK and not about what is behind it: an unguessable
 * id, revocation, one live link per subject, and a 404 that will not say
 * whether an id was ever real. Splitting it would mean two implementations of
 * those four properties, and the second would be the one with the bug.
 */
export interface BinderShare extends ShareBase {
  kind: "binder";
  binderId: string;
  binderName: string;
}

export type Share = SetShare | BinderShare;

/**
 * Rows written before binder shares existed carry no `kind` at all, and there
 * is a live shares.json on the server holding them. An absent kind is "set" —
 * the only thing it could have been.
 */
function isShare(value: unknown): value is Share {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || typeof v.createdAt !== "number") return false;
  if (v.kind === "binder") return typeof v.binderId === "string" && typeof v.binderName === "string";
  return typeof v.setId === "string" && typeof v.setName === "string";
}

/** Normalise a legacy row into the tagged shape the rest of the file expects. */
function withKind(value: Share): Share {
  return value.kind === "binder" || value.kind === "set" ? value : { ...(value as SetShare), kind: "set" };
}
export class ShareStore {
  private shares = new Map<string, Share>();

  constructor(private readonly filePath: string) {
    this.load();
  }

  private load(): void {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, "utf8"));
      if (!Array.isArray(parsed)) return;
      for (const row of parsed) if (isShare(row)) this.shares.set(row.id, withKind(row));
    } catch {
      // No file yet, or corrupt. An unreadable share list must not stop the
      // server booting — collection sync is the important thing here.
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify([...this.shares.values()], null, 2), "utf8");
    } catch (err) {
      console.warn("[cardlens] could not persist shares:", err);
    }
  }

  /**
   * The live share for a set, creating one if needed.
   *
   * Reused rather than minted per press: pressing Share twice should not leave
   * two live links to the same set, one of which the user has forgotten about
   * and cannot see to revoke.
   */
  createOrReuse(setId: string, setName: string, now = Date.now()): SetShare {
    for (const share of this.shares.values()) {
      if (share.kind === "set" && share.setId === setId && share.revokedAt === undefined) {
        // Keep the name current: a set renamed upstream should not leave the
        // shared page titled with the old one.
        if (share.setName !== setName) {
          const updated: SetShare = { ...share, setName };
          this.shares.set(share.id, updated);
          this.persist();
          return updated;
        }
        return share;
      }
    }

    const share: SetShare = {
      id: randomBytes(16).toString("base64url"),
      kind: "set",
      setId,
      setName,
      createdAt: now,
    };
    this.shares.set(share.id, share);
    this.persist();
    return share;
  }

  /**
   * The live link for one binder, creating it if needed.
   *
   * Same reuse rule as a set, and for the same reason: pressing "Share for
   * trade" twice must not leave a second live link the owner has forgotten
   * about and so cannot revoke. Renaming the binder updates the existing link
   * rather than minting a new one — the link is to the binder, not to its name.
   */
  createOrReuseBinder(binderId: string, binderName: string, now = Date.now()): BinderShare {
    for (const share of this.shares.values()) {
      if (share.kind === "binder" && share.binderId === binderId && share.revokedAt === undefined) {
        if (share.binderName !== binderName) {
          const updated: BinderShare = { ...share, binderName };
          this.shares.set(share.id, updated);
          this.persist();
          return updated;
        }
        return share;
      }
    }

    const share: BinderShare = {
      id: randomBytes(16).toString("base64url"),
      kind: "binder",
      binderId,
      binderName,
      createdAt: now,
    };
    this.shares.set(share.id, share);
    this.persist();
    return share;
  }

  /** The live link for a binder, if it has one. Lets the owner show its state. */
  liveForBinder(binderId: string): BinderShare | null {
    for (const share of this.shares.values()) {
      if (share.kind === "binder" && share.binderId === binderId && share.revokedAt === undefined) {
        return share;
      }
    }
    return null;
  }
  /** A live share, or null when unknown or revoked. Never says which. */
  get(id: string): Share | null {
    const share = this.shares.get(id);
    if (!share || share.revokedAt !== undefined) return null;
    return share;
  }

  revoke(id: string, now = Date.now()): boolean {
    const share = this.shares.get(id);
    if (!share || share.revokedAt !== undefined) return false;
    this.shares.set(id, { ...share, revokedAt: now });
    this.persist();
    return true;
  }

  /** Every live share, for a "what am I sharing" list. */
  live(): Share[] {
    return [...this.shares.values()]
      .filter((s) => s.revokedAt === undefined)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
}
