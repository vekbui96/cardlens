import { describe, expect, it } from "vitest";
import { syncLine } from "./syncLine.ts";
import type { SyncStatus } from "../../app/LibraryProvider.tsx";

const status = (over: Partial<SyncStatus> = {}): SyncStatus => ({
  state: "idle",
  pending: 0,
  lastSyncAt: 0,
  ...over,
});

describe("syncLine", () => {
  it("invites connecting when off", () => {
    const line = syncLine(status({ state: "off" }));
    expect(line.label).toMatch(/off/i);
    expect(line.hint).toMatch(/connect/i);
    expect(line.on).toBe(false);
  });

  it("says a token was rejected rather than calling it offline", () => {
    // These are different problems: offline fixes itself, a bad token never
    // does, so they must never share wording.
    const line = syncLine(status({ state: "bad-token" }));
    expect(line.label).toMatch(/rejected/i);
    expect(line.hint).toMatch(/re-enter/i);
  });

  it("points at the server when sync is disabled there", () => {
    expect(syncLine(status({ state: "disabled" })).hint).toMatch(/COLLECTION_TOKEN/);
  });

  it("reassures rather than alarms when offline", () => {
    const line = syncLine(status({ state: "offline" }));
    expect(line.hint).toMatch(/retry/i);
  });

  it("counts pending changes when offline", () => {
    expect(syncLine(status({ state: "offline", pending: 14 })).hint).toContain("14");
  });

  it("uses the singular for one pending change", () => {
    expect(syncLine(status({ state: "offline", pending: 1 })).hint).toBe("1 change waiting");
  });

  it("shows how long ago the last sync was", () => {
    const line = syncLine(status({ lastSyncAt: Date.now() - 5 * 60_000 }));
    expect(line.hint).toMatch(/5m ago/);
  });

  it("switches to hours then days", () => {
    expect(syncLine(status({ lastSyncAt: Date.now() - 3 * 3_600_000 })).hint).toMatch(/3h ago/);
    expect(syncLine(status({ lastSyncAt: Date.now() - 2 * 86_400_000 })).hint).toMatch(/2d ago/);
  });

  it("reports pending work ahead of the last-synced time", () => {
    const line = syncLine(status({ pending: 3, lastSyncAt: Date.now() }));
    expect(line.label).toMatch(/pending/i);
    expect(line.hint).toBe("3 changes waiting");
  });
});
