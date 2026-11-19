import { afterEach, describe, expect, it, vi } from "vitest";
import { judgeMault, MaultClient, type MaultConfig, type MaultMatch } from "./mault.ts";
import type { CardIndexLookup, IndexCard } from "./cardIndexLookup.ts";
import type { IdentifyReply } from "../src/models/identify.ts";

/**
 * No live Mault here: every call is a stubbed fetch. What these pin down is the
 * gate (never auto-accept a same-art reprint or a weak match), the id
 * translation, and that every way Mault can fail becomes a 503 the UI can say
 * "offline, retry" about.
 */

function card(id: string, name: string): IndexCard {
  const [setId, number] = id.split("-");
  return { id, name, number, setId, setName: `Set ${setId}` };
}

const CARDS = new Map(
  [
    card("sv1-1", "Pineco"),
    card("g1-56", "Leafeon-EX"),
    card("xy8-117", "Leafeon-EX"),
    card("bw4-51", "Kyurem"),
    card("bw11-52", "Kyurem"),
    card("xy5-108", "M Sceptile-EX"),
    card("base1-4", "Charizard"),
    card("sv2-169", "Ralts"),
    card("sv4pt5-75", "Ralts"),
  ].map((c) => [c.id, c]),
);

const m = (cardId: string, confidence: number, distance: number, name?: string): MaultMatch => ({
  cardId,
  confidence,
  distance,
  ...(name ? { card: { name } } : {}),
});

describe("judgeMault", () => {
  it("accepts a clear, close, uncontested match and translates its id", () => {
    const reply = judgeMault([m("sv01-001", 0.999, 0.003, "Pineco"), m("sv07-016", 0.0, 0.397)], CARDS);
    expect(reply.status).toBe("MATCHED");
    expect(reply.candidates.map((c) => c.cardId)).toEqual(["sv1-1"]);
    expect(reply.candidates[0]).toMatchObject({ name: "Pineco", setId: "sv1", collectorNumber: "1" });
    expect(reply.recogniser).toBe("mault");
  });

  it("leaves a same-art reprint pair unsettled, with both offered", () => {
    // Both score ~0.999: Mault's confidence is per candidate, not a softmax.
    const reply = judgeMault([m("g1-56", 0.999, 0.003, "Leafeon-EX"), m("xy8-117", 0.999, 0.004)], CARDS);
    expect(reply.status).toBe("AMBIGUOUS");
    expect(reply.candidates.map((c) => c.cardId)).toEqual(["g1-56", "xy8-117"]);
    expect(reply.reason).toMatch(/almost the same/);
  });

  it("does not accept the reprint Mault got wrong in the trial (bw11-52 read as bw4-51)", () => {
    const reply = judgeMault([m("bw4-51", 0.672, 0.003, "Kyurem"), m("bw11-52", 0.295, 0.044)], CARDS);
    expect(reply.status).toBe("AMBIGUOUS");
    expect(reply.candidates.map((c) => c.cardId)).toContain("bw11-52");
  });

  it("does not accept a lone weak match (xyp-XY39 read as xy5-108)", () => {
    const reply = judgeMault([m("xy5-108", 0.579, 0.346, "M Sceptile-EX")], CARDS);
    expect(reply.status).toBe("AMBIGUOUS");
  });

  it("does not accept a confident score on a distant match", () => {
    expect(judgeMault([m("base1-4", 0.97, 0.3, "Charizard")], CARDS).status).toBe("AMBIGUOUS");
  });

  it("counts an untranslatable runner-up as a rival", () => {
    // CardLens not indexing the near twin does not make the top one safe.
    const reply = judgeMault([m("base1-4", 0.99, 0.001, "Charizard"), m("nowhere-1", 0.98, 0.002)], CARDS);
    expect(reply.status).toBe("AMBIGUOUS");
    expect(reply.candidates).toHaveLength(1);
  });

  it("never promotes the runner-up when the top match cannot be translated", () => {
    const reply = judgeMault([m("nowhere-1", 0.99, 0.001), m("base1-4", 0.1, 0.4)], CARDS);
    expect(reply.status).toBe("AMBIGUOUS");
    expect(reply.candidates.map((c) => c.cardId)).toEqual(["base1-4"]);
  });

  it("does not accept when Mault's name for the card disagrees with ours", () => {
    expect(judgeMault([m("base1-4", 0.99, 0.001, "Blastoise")], CARDS).status).toBe("AMBIGUOUS");
  });

  it("tolerates the two catalogues' different spellings of a name", () => {
    const named = new Map([
      ...CARDS,
      ["xy1-1", card("xy1-1", "Venusaur-EX")],
      ["dp1-120", card("dp1-120", "Empoleon LV.X")],
    ]);
    expect(judgeMault([m("xy1-1", 0.99, 0.001, "Venusaur EX")], named).status).toBe("MATCHED");
    expect(judgeMault([m("dp1-120", 0.99, 0.001, "Empoleon")], named).status).toBe("MATCHED");
  });

  it("is UNKNOWN when nothing resolves", () => {
    expect(judgeMault([], CARDS).status).toBe("UNKNOWN");
    expect(judgeMault([m("nowhere-1", 0.99, 0.001)], CARDS).status).toBe("UNKNOWN");
  });

  it("offers at most three, without duplicates", () => {
    const reply = judgeMault(
      [
        m("sv02-169", 0.99, 0.004),
        m("sv04.5-075", 0.99, 0.005),
        m("sv2-169", 0.5, 0.1),
        m("g1-56", 0.1, 0.3),
        m("xy8-117", 0.1, 0.3),
      ],
      CARDS,
    );
    expect(reply.candidates.map((c) => c.cardId)).toEqual(["sv2-169", "sv4pt5-75", "g1-56"]);
  });
});

const CONFIG: MaultConfig = {
  url: "http://mault.test",
  email: "e@example.test",
  password: "pw",
  orgId: "org",
  collectionGuid: "guid",
};
const lookup = { load: () => Promise.resolve(CARDS) } as unknown as CardIndexLookup;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const signIn = (token: string) => json(200, { success: true, data: { token } });
const found = () => json(200, { success: true, data: [m("sv01-001", 0.999, 0.003, "Pineco")] });

afterEach(() => vi.unstubAllGlobals());

describe("MaultClient", () => {
  it("is unavailable, without calling anything, when unconfigured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = new MaultClient(lookup, { ...CONFIG, password: "" });
    const reply = await client.identify(Buffer.from("img"), "image/jpeg");
    expect(reply).toEqual({ status: 503, body: { error: "mault_unavailable" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("signs in, sends the photo with the collection and org, and returns mapped ids", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(signIn("t1")).mockResolvedValueOnce(found());
    vi.stubGlobal("fetch", fetchMock);
    const reply = await new MaultClient(lookup, CONFIG).identify(Buffer.from("img"), "image/jpeg");

    expect(reply.status).toBe(200);
    expect((reply.body as IdentifyReply).candidates[0].cardId).toBe("sv1-1");
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("http://mault.test/cards");
    expect(init.headers).toEqual({ Authorization: "Bearer t1", "X-Org-Id": "org" });
    const form = init.body as FormData;
    expect(form.get("collectionGuid")).toBe("guid");
    expect((form.get("image") as Blob).type).toBe("image/jpeg");
  });

  it("reuses the token, and signs in again exactly once on a 401", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(signIn("t1"))
      .mockResolvedValueOnce(found())
      .mockResolvedValueOnce(json(401, { message: "Unauthorized" }))
      .mockResolvedValueOnce(signIn("t2"))
      .mockResolvedValueOnce(found());
    vi.stubGlobal("fetch", fetchMock);
    const client = new MaultClient(lookup, CONFIG);

    await client.identify(Buffer.from("a"), "image/png");
    const second = await client.identify(Buffer.from("b"), "image/png");

    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[4][1].headers.Authorization).toBe("Bearer t2");
  });

  it("gives up after a second 401 rather than looping", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(signIn("t1"))
      .mockResolvedValueOnce(json(401, {}))
      .mockResolvedValueOnce(signIn("t2"))
      .mockResolvedValueOnce(json(401, {}));
    vi.stubGlobal("fetch", fetchMock);
    const reply = await new MaultClient(lookup, CONFIG).identify(Buffer.from("a"), "image/png");
    expect(reply).toEqual({ status: 503, body: { error: "mault_unavailable" } });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("reports refused credentials as unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(401, { message: "bad" })));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reply = await new MaultClient(lookup, CONFIG).identify(Buffer.from("a"), "image/png");
    expect(reply).toEqual({ status: 503, body: { error: "mault_unavailable" } });
    // The warning must never carry the secret.
    expect(JSON.stringify(warn.mock.calls)).not.toContain("pw");
    warn.mockRestore();
  });

  it("reports a stopped Mault as 503, not a crash", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reply = await new MaultClient(lookup, CONFIG).identify(Buffer.from("a"), "image/png");
    expect(reply).toEqual({ status: 503, body: { error: "mault_unavailable" } });
    warn.mockRestore();
  });

  it("distinguishes a wedged Mault", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(signIn("t1"))
      .mockRejectedValueOnce(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
    vi.stubGlobal("fetch", fetchMock);
    const reply = await new MaultClient(lookup, CONFIG).identify(Buffer.from("a"), "image/png");
    expect(reply).toEqual({ status: 503, body: { error: "mault_timeout" } });
  });

  it("answers UNKNOWN, not offline, for a photo Mault cannot decode", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(signIn("t1"))
      .mockResolvedValueOnce(json(500, { success: false, message: "Failed to vectorize image." }));
    vi.stubGlobal("fetch", fetchMock);
    const reply = await new MaultClient(lookup, CONFIG).identify(Buffer.from("a"), "image/png");
    expect(reply.status).toBe(200);
    expect((reply.body as IdentifyReply).status).toBe("UNKNOWN");
  });

  it("treats any other server error as unavailable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(signIn("t1"))
      .mockResolvedValueOnce(json(500, { message: "database down" }));
    vi.stubGlobal("fetch", fetchMock);
    const reply = await new MaultClient(lookup, CONFIG).identify(Buffer.from("a"), "image/png");
    expect(reply).toEqual({ status: 503, body: { error: "mault_unavailable" } });
  });

  it("offers Mault's diagnostic candidates when it is unsure (data: null), never pre-chosen", async () => {
    // The real shape of an unsure answer — what every phone photo got on
    // 2026-11-19, and which used to surface as "offline on the server".
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(signIn("t1"))
      .mockResolvedValueOnce(
        json(200, {
          success: true,
          data: null,
          nearestDistance: 0.534,
          diagnostics: {
            reason: "ambiguous",
            candidates: [
              { cardId: "sv01-001", name: "Pineco", setCode: "sv01", distance: 0.534 },
              { cardId: "bw11-52", name: "Kyurem", setCode: "bw11", distance: 0.553 },
            ],
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const reply = await new MaultClient(lookup, CONFIG).identify(Buffer.from("a"), "image/jpeg");
    expect(reply.status).toBe(200);
    const body = reply.body as IdentifyReply;
    expect(body.status).toBe("AMBIGUOUS");
    expect(body.candidates.map((c) => c.cardId)).toEqual(["sv1-1", "bw11-52"]);
  });

  it("answers UNKNOWN when Mault is unsure and names nothing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(signIn("t1"))
      .mockResolvedValueOnce(json(200, { success: true, data: null }));
    vi.stubGlobal("fetch", fetchMock);
    const reply = await new MaultClient(lookup, CONFIG).identify(Buffer.from("a"), "image/jpeg");
    expect(reply.status).toBe(200);
    expect((reply.body as IdentifyReply).status).toBe("UNKNOWN");
  });

  it("refuses a malformed answer instead of forwarding it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(signIn("t1"))
      .mockResolvedValueOnce(new Response("<html>oops</html>", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const reply = await new MaultClient(lookup, CONFIG).identify(Buffer.from("a"), "image/png");
    expect(reply).toEqual({ status: 502, body: { error: "mault_bad_response" } });
  });
});
