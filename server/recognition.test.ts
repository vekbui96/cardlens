import { afterEach, describe, expect, it, vi } from "vitest";
import { callRecogniser, recogniserHealth } from "./recognition.ts";

/**
 * The proxy's job is to be boring and honest: pass the bytes through untouched,
 * and turn every way the recogniser can be unavailable into a state the UI can
 * act on rather than an exception.
 */

const multipart = "multipart/form-data; boundary=----abc123";

afterEach(() => vi.unstubAllGlobals());

function respondWith(status: number, body: string, ok = true) {
  return vi.fn().mockResolvedValue({
    status,
    ok,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
  } as unknown as Response);
}

describe("callRecogniser", () => {
  it("forwards the body and content-type untouched", async () => {
    // The boundary lives in the content-type and the bytes are a multipart
    // envelope: re-encoding either would corrupt the upload, which is why this
    // proxy takes a Buffer rather than parsed JSON.
    const fetchMock = respondWith(200, '{"status":"MATCHED"}');
    vi.stubGlobal("fetch", fetchMock);

    const body = Buffer.from("----abc123\r\nimage bytes\r\n");
    await callRecogniser(body, multipart);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["Content-Type"]).toBe(multipart);
    expect(Buffer.from(init.body)).toEqual(body);
  });

  it("reports a stopped recogniser as 503, not as a crash", async () => {
    // "Offline" is actionable; a 500 is not.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED"), { name: "TypeError" })),
    );
    const reply = await callRecogniser(Buffer.from("x"), multipart);
    expect(reply.status).toBe(503);
    expect(reply.body).toEqual({ error: "recognition_unavailable" });
  });

  it("distinguishes a wedged recogniser from a stopped one", async () => {
    // A hang and a refusal need different words: one means restart it, the
    // other means it is already restarting.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("timed out"), { name: "TimeoutError" })),
    );
    const reply = await callRecogniser(Buffer.from("x"), multipart);
    expect(reply.body).toEqual({ error: "recognition_timeout" });
  });

  it("does not forward a non-JSON body to a public endpoint", async () => {
    // A Python traceback rendered as HTML would otherwise be relayed straight
    // to the internet.
    vi.stubGlobal("fetch", respondWith(500, "<html>Traceback (most recent call last)...</html>", false));
    const reply = await callRecogniser(Buffer.from("x"), multipart);
    expect(reply.status).toBe(502);
    expect(reply.body).toEqual({ error: "recognition_bad_response" });
  });

  it("passes a refusal through with its own status and reason", async () => {
    // The recogniser's 400 INVALID_IMAGE is more useful than a generic error.
    vi.stubGlobal("fetch", respondWith(400, '{"detail":{"code":"INVALID_IMAGE"}}', false));
    const reply = await callRecogniser(Buffer.from("x"), multipart);
    expect(reply.status).toBe(400);
    expect(reply.body).toEqual({ detail: { code: "INVALID_IMAGE" } });
  });
});

describe("recogniserHealth", () => {
  it("reports the index size when up", async () => {
    vi.stubGlobal("fetch", respondWith(200, '{"ok":true,"cards":1709}'));
    expect((await recogniserHealth()).body).toEqual({ ok: true, cards: 1709 });
  });

  it("answers rather than throwing when down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    const reply = await recogniserHealth();
    expect(reply.status).toBe(503);
    expect(reply.body).toMatchObject({ ok: false });
  });
});
