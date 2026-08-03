import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";

/**
 * Live set shares.
 *
 * `models/showcase.ts` deliberately put the data IN the link so nothing was
 * ever uploaded and no id could be guessed. A live share cannot do that — the
 * whole point is that the page re-reads the collection after it was sent — so
 * this rebuilds the thing that was avoided, and has to answer the objections
 * that decision listed:
 *
 * - **Guessing**: ids are 16 random bytes, base64url. Not derived from the set
 *   id, the owner or the clock, so knowing one tells you nothing about another.
 * - **Revocation**: a share can be turned off, which a snapshot link never
 *   could — once pasted, that data was out forever.
 * - **Scope**: a share names ONE set. It is not a key to the collection.
 *
 * What it still cannot do is un-send what someone already saw. Revoking stops
 * future reads; it does not retract a screenshot.
 */
export interface Share {
  id: string;
  setId: string;
  setName: string;
  createdAt: number;
  /** Present means the link is dead. Kept, not deleted, so the id is never reissued. */
  revokedAt?: number;
}

function isShare(value: unknown): value is Share {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.setId === "string" &&
    typeof v.setName === "string" &&
    typeof v.createdAt === "number"
  );
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
      for (const row of parsed) if (isShare(row)) this.shares.set(row.id, row);
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
  createOrReuse(setId: string, setName: string, now = Date.now()): Share {
    for (const share of this.shares.values()) {
      if (share.setId === setId && share.revokedAt === undefined) {
        // Keep the name current: a set renamed upstream should not leave the
        // shared page titled with the old one.
        if (share.setName !== setName) {
          const updated = { ...share, setName };
          this.shares.set(share.id, updated);
          this.persist();
          return updated;
        }
        return share;
      }
    }

    const share: Share = {
      id: randomBytes(16).toString("base64url"),
      setId,
      setName,
      createdAt: now,
    };
    this.shares.set(share.id, share);
    this.persist();
    return share;
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
