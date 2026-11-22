import { describe, expect, it } from "vitest";
import type { SyncStatus } from "../../../app/LibraryProvider.tsx";
import { emptySyncLine } from "./emptySyncLine.ts";

const status = (state: SyncStatus["state"]): SyncStatus => ({ state, pending: 0, lastSyncAt: 0 });

describe("emptySyncLine", () => {
  it("explains an offline device", () => {
    expect(emptySyncLine(status("offline"))).toMatch(/offline/);
  });

  it("says nothing is lost when the server cannot be reached", () => {
    expect(emptySyncLine(status("idle"))).toMatch(/Can't reach the CardLens server/);
    expect(emptySyncLine(status("idle"))).toMatch(/nothing is lost/);
  });

  it("says a refused token needs connecting again", () => {
    expect(emptySyncLine(status("bad-token"))).toMatch(/token was refused/);
  });

  it.each(["off", "syncing", "disabled"] as const)("adds nothing when sync is %s", (state) => {
    expect(emptySyncLine(status(state))).toBeNull();
  });
});
