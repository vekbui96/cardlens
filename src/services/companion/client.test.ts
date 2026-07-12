import { describe, expect, it, vi, afterEach } from "vitest";
import { CompanionClient } from "./client.ts";

function jsonResponse(data: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

afterEach(() => vi.restoreAllMocks());

describe("CompanionClient", () => {
  it("creates a session with a POST (regression: was a GET -> 404)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ sessionId: "s1", code: "ABC123", expiresAt: 123 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new CompanionClient("/api");
    const session = await client.createSession();

    expect(session).toEqual({ sessionId: "s1", code: "ABC123", expiresAt: 123 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/session");
    expect((init as RequestInit).method).toBe("POST");
  });

  it("retries createSession on transient failure (cold start)", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(jsonResponse({ sessionId: "s2", code: "ZZZ999", expiresAt: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new CompanionClient("/api");
    const session = await client.createSession(undefined, 3);
    expect(session.code).toBe("ZZZ999");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("submits a value via POST with a JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new CompanionClient("/api");
    const ok = await client.submit("ABC123", "Charizard ex");
    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/session/ABC123/submit");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ value: "Charizard ex" });
  });

  it("waitForInput polls (GET) and resolves with the submitted value", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "submitted", value: "Pikachu" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new CompanionClient("/api");
    const value = await client.waitForInput("ABC123", { intervalMs: 1 });
    expect(value).toBe("Pikachu");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/session/ABC123");
    // GET (no explicit method).
    expect((init as RequestInit).method).toBeUndefined();
  });

  it("waitForInput returns null when the session is expired", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "expired" }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new CompanionClient("/api");
    expect(await client.waitForInput("ABC123", { intervalMs: 1 })).toBeNull();
  });
});
