import { describe, expect, it } from "vitest";
import { SyncAuthError, SyncDisabledError, SyncNotFoundError, SyncTooLargeError } from "./http.ts";
import { syncFailureMetric } from "./syncMetric.ts";

describe("syncFailureMetric", () => {
  it.each([
    [new SyncAuthError(), "sync.bad_token"],
    [new SyncDisabledError(), "sync.disabled"],
    [new SyncTooLargeError(), "sync.fail.too_large"],
    [new SyncNotFoundError(), "sync.fail.http"],
    [new TypeError("Failed to fetch"), "sync.fail.offline"],
    [new DOMException("aborted", "AbortError"), "sync.fail.offline"],
    [new Error("sync failed (HTTP 500)"), "sync.fail.http"],
    ["something odd", "sync.fail.http"],
  ])("counts %s as %s", (err, expected) => {
    expect(syncFailureMetric(err)).toBe(expected);
  });
});
