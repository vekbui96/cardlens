import { describe, expect, it } from "vitest";
import { SessionStore } from "./sessionStore.ts";

describe("SessionStore", () => {
  it("creates sessions with a unique code and expiry", () => {
    const now = 1000;
    const store = new SessionStore(300_000, () => now);
    const a = store.create();
    const b = store.create();
    expect(a.code).not.toBe(b.code);
    expect(a.code).toHaveLength(6);
    expect(a.expiresAt).toBe(1000 + 300_000);
  });

  it("reports pending, then submitted", () => {
    const now = 0;
    const store = new SessionStore(300_000, () => now);
    const s = store.create();
    expect(store.status(s.code).status).toBe("pending");
    store.submit(s.code, "Charizard");
    const status = store.status(s.code);
    expect(status.status).toBe("submitted");
    expect(status.value).toBe("Charizard");
  });

  it("is case-insensitive on the code", () => {
    const store = new SessionStore(300_000, () => 0);
    const s = store.create();
    expect(store.submit(s.code.toLowerCase(), "x").ok).toBe(true);
  });

  it("expires sessions after the TTL", () => {
    let now = 0;
    const store = new SessionStore(1000, () => now);
    const s = store.create();
    now = 1500;
    expect(store.status(s.code).status).toBe("expired");
    expect(store.submit(s.code, "late").ok).toBe(false);
  });

  it("reports not-found for unknown codes", () => {
    const store = new SessionStore(1000, () => 0);
    expect(store.status("ZZZZZZ").status).toBe("not-found");
  });

  it("sweeps expired sessions", () => {
    let now = 0;
    const store = new SessionStore(1000, () => now);
    store.create();
    expect(store.size).toBe(1);
    now = 2000;
    store.sweep();
    expect(store.size).toBe(0);
  });
});
