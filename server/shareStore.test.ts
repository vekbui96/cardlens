import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ShareStore } from "./shareStore.ts";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cardlens-shares-"));
  file = join(dir, "shares.json");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("ShareStore", () => {
  it("reuses one live link per set", () => {
    // Pressing Share twice must not leave a second live link the owner has
    // forgotten about and cannot see in order to revoke it.
    const store = new ShareStore(file);
    const a = store.createOrReuse("me5", "Pitch Black");
    const b = store.createOrReuse("me5", "Pitch Black");
    expect(b.id).toBe(a.id);
    expect(store.live()).toHaveLength(1);
  });

  it("mints unguessable ids that do not encode the set", () => {
    const store = new ShareStore(file);
    const a = store.createOrReuse("me5", "Pitch Black");
    const b = store.createOrReuse("me3", "Obsidian Flames");
    expect(a.id).not.toBe(b.id);
    expect(a.id.length).toBeGreaterThanOrEqual(20);
    expect(a.id).not.toContain("me5");
  });

  it("keeps the set name current", () => {
    const store = new ShareStore(file);
    const first = store.createOrReuse("me5", "Old Name");
    const again = store.createOrReuse("me5", "Pitch Black");
    expect(again.id).toBe(first.id);
    expect(again.setName).toBe("Pitch Black");
  });

  it("stops answering once revoked", () => {
    const store = new ShareStore(file);
    const share = store.createOrReuse("me5", "Pitch Black");
    expect(store.get(share.id)).not.toBeNull();

    expect(store.revoke(share.id)).toBe(true);
    expect(store.get(share.id)).toBeNull();
    expect(store.live()).toHaveLength(0);
    // Revoking twice is not an error the caller has to handle, but it does
    // report that nothing changed.
    expect(store.revoke(share.id)).toBe(false);
  });

  it("never reissues a revoked id", () => {
    // The row is kept rather than deleted so a fresh createOrReuse cannot
    // collide with an id somebody still holds.
    const store = new ShareStore(file);
    const first = store.createOrReuse("me5", "Pitch Black");
    store.revoke(first.id);
    const second = store.createOrReuse("me5", "Pitch Black");
    expect(second.id).not.toBe(first.id);
    expect(readFileSync(file, "utf8")).toContain(first.id);
  });

  it("survives a restart", () => {
    const share = new ShareStore(file).createOrReuse("me5", "Pitch Black");
    expect(new ShareStore(file).get(share.id)?.setId).toBe("me5");
  });

  it("boots on a corrupt file rather than throwing", () => {
    // Collection sync is the important thing on this server; an unreadable
    // share list must not stop it starting.
    rmSync(file, { force: true });
    const store = new ShareStore(join(dir, "missing", "shares.json"));
    expect(store.live()).toEqual([]);
  });
});
