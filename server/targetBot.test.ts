import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The token is read at module load, so each test imports a fresh copy after
 * setting the environment it wants.
 */
async function load(token: string | undefined) {
  vi.resetModules();
  if (token === undefined) delete process.env.TARGET_BOT_TOKEN;
  else process.env.TARGET_BOT_TOKEN = token;
  return import("./targetBot.ts");
}

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.TARGET_BOT_TOKEN;
});

describe("validTcin", () => {
  it("accepts digit strings only", async () => {
    const { validTcin } = await load("t");
    expect(validTcin("93565639")).toBe(true);
    expect(validTcin("1011209279")).toBe(true);
    expect(validTcin("../../etc")).toBe(false);
    expect(validTcin("93565639; DROP")).toBe(false);
    expect(validTcin("")).toBe(false);
    expect(validTcin(12345)).toBe(false);
  });
});

describe("callBot", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it("fails closed when no token is configured", async () => {
    const { callBot } = await load(undefined);
    const reply = await callBot("GET", "/api/target/state");
    expect(reply.status).toBe(503);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("passes the bot's own status and body straight through", async () => {
    const { callBot } = await load("secret");
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ products: [] }), { status: 200 }),
    );

    const reply = await callBot("GET", "/api/target/state");
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ products: [] });

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect((init?.headers as Record<string, string>)["X-Bot-Token"]).toBe("secret");
  });

  it("keeps a bot error status rather than flattening it to 500", async () => {
    // A 404 for an unknown TCIN must stay a 404: the UI says "not found",
    // where a 500 would say "something broke".
    const { callBot } = await load("secret");
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: "not-found" }), { status: 404 }),
    );

    const reply = await callBot("DELETE", "/api/target/watchlist/1");
    expect(reply.status).toBe(404);
  });

  it("reports an unreachable bot as 503, not an exception", async () => {
    const { callBot } = await load("secret");
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error("ECONNREFUSED"));

    const reply = await callBot("GET", "/api/target/state");
    expect(reply.status).toBe(503);
    expect(reply.body).toEqual({ error: "target_bot_unreachable" });
  });

  it("separates a timeout from an unreachable bot", async () => {
    // A slow check and a dead bot need different wording on screen, so they
    // must not collapse into one status here.
    const { callBot } = await load("secret");
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    vi.mocked(globalThis.fetch).mockRejectedValue(timeout);

    const reply = await callBot("POST", "/api/target/watchlist/1/check");
    expect(reply.status).toBe(504);
    expect(reply.body).toEqual({ error: "target_bot_timeout" });
  });

  it("treats a non-JSON body as a broken bot", async () => {
    const { callBot } = await load("secret");
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response("<html>502</html>", { status: 200 }));

    const reply = await callBot("GET", "/api/target/state");
    expect(reply.status).toBe(502);
  });

  it("sends no body or content-type on a bodyless call", async () => {
    const { callBot } = await load("secret");
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response("{}", { status: 200 }));

    await callBot("GET", "/api/target/state");
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(init?.body).toBeUndefined();
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });
});
