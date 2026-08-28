import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson } from "./http.ts";
import { ProviderError } from "../integrations/providers.ts";

/**
 * The status carried on the error, which is the part callers act on.
 *
 * Two screens make a decision from it that changes what the user is told to do:
 * the share screen separates 401 (re-enter the token) from 503 (sync is off at
 * the server, and retrying will never help), and the trade link recognises 409
 * ("this binder has not synced yet"). Both used to recover it with a regex over
 * the message — a format, not an interface, which fails silently the day the
 * wording changes. These tests are what stop it becoming recoverable only that
 * way again.
 */

function respond(status: number, body: unknown = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(status === 204 ? null : JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchJson", () => {
  it("returns the parsed body when the request succeeds", async () => {
    respond(200, { id: "abc" });
    expect(await fetchJson("/api/thing")).toEqual({ id: "abc" });
  });

  it.each([
    [401, "network"],
    [403, "network"],
    [409, "network"],
    [500, "network"],
    [503, "network"],
    [404, "not-found"],
    [429, "rate-limit"],
  ])("carries status %i on the error", async (status, kind) => {
    respond(status);
    await expect(fetchJson("/api/thing")).rejects.toMatchObject({ status, kind });
  });

  it("leaves status absent when there was no answer at all", async () => {
    // A timeout or nothing listening. The absence is meaningful: "the server
    // said no" and "there was no server" have different fixes, and this is how
    // a caller tells them apart.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const err = await fetchJson("/api/thing").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).status).toBeUndefined();
    expect((err as ProviderError).kind).toBe("network");
  });

  it("re-throws a caller's abort rather than dressing it as a failure", async () => {
    // An abort is a cancelled query, not an error state — TanStack Query needs
    // it to pass through so a stale request does not surface to the user.
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("Aborted", "AbortError");
      }),
    );

    const err = await fetchJson("/api/thing", { signal: controller.signal }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe("AbortError");
  });
});
