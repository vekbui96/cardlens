import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SyncAuthError,
  SyncDisabledError,
  SyncNotFoundError,
  SyncTooLargeError,
  syncRequest,
} from "./http.ts";

function respondWith(status: number) {
  return vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve({ ok: true }),
  } as unknown as Response);
}

afterEach(() => vi.unstubAllGlobals());

describe("syncRequest", () => {
  it("names the failures that stay broken until someone acts", async () => {
    // Each of these is surfaced differently on screen, so collapsing any of
    // them into a generic error would hide a wrong token behind "offline".
    const cases: [number, unknown][] = [
      [401, SyncAuthError],
      [503, SyncDisabledError],
      [413, SyncTooLargeError],
      [404, SyncNotFoundError],
    ];
    for (const [status, error] of cases) {
      vi.stubGlobal("fetch", respondWith(status));
      await expect(syncRequest("/api", "t", "/binders")).rejects.toBeInstanceOf(error as new () => Error);
    }
  });

  it("distinguishes a missing route from a server that is merely unhappy", async () => {
    // 404 means "this server predates the endpoint" — Pages and the home server
    // deploy separately, so that is a normal transient state rather than a
    // fault, and the caller skips instead of retrying forever.
    vi.stubGlobal("fetch", respondWith(500));
    await expect(syncRequest("/api", "t", "/binders")).rejects.not.toBeInstanceOf(SyncNotFoundError);
  });

  it("sends the token as a bearer header", async () => {
    const fetchMock = respondWith(200);
    vi.stubGlobal("fetch", fetchMock);
    await syncRequest("/api", "secret", "/binders");
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe("Bearer secret");
  });
});
