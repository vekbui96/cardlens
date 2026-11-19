import { afterEach, describe, expect, it, vi } from "vitest";
import { PhotoAuthError, PhotoUnavailableError, identifyPhoto, toPhotoScanResult } from "./photoIdentify.ts";
import type { IdentifyReply } from "../models/identify.ts";
import type { CardIndex } from "./cardIndex.ts";

const photo = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });

function cand(cardId: string, name: string, confidence: number, distance: number) {
  const [setId, collectorNumber] = cardId.split("-");
  return { cardId, name, setId, setName: `Set ${setId}`, collectorNumber, confidence, distance };
}

const MATCHED: IdentifyReply = {
  status: "MATCHED",
  candidates: [cand("sv1-1", "Pineco", 0.999, 0.003)],
  reason: "Mault 100% sure",
  recogniser: "mault",
  processingTimeMs: 120,
};

const AMBIGUOUS: IdentifyReply = {
  status: "AMBIGUOUS",
  candidates: [cand("g1-56", "Leafeon-EX", 0.999, 0.003), cand("xy8-117", "Leafeon-EX", 0.999, 0.004)],
  reason: "Mault: another card looks almost the same — check the number",
  recogniser: "mault",
  processingTimeMs: 110,
};

function respond(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

afterEach(() => vi.unstubAllGlobals());

describe("identifyPhoto", () => {
  it("posts the raw photo with its type and the bearer token", async () => {
    const fetchMock = respond(200, MATCHED);
    vi.stubGlobal("fetch", fetchMock);
    const result = await identifyPhoto(photo, "tok");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/cards\/identify$/);
    expect(init.body).toBe(photo);
    expect(init.headers).toMatchObject({ authorization: "Bearer tok", "content-type": "image/jpeg" });
    expect(result.confident).toBe(true);
    expect(result.candidates[0].card.id).toBe("sv1-1");
  });

  it("refuses without a token, without touching the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(identifyPhoto(photo, "")).rejects.toBeInstanceOf(PhotoAuthError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("separates a refused token (no retry) from an offline engine (retry)", async () => {
    vi.stubGlobal("fetch", respond(401, { error: "unauthorized" }));
    await expect(identifyPhoto(photo, "tok")).rejects.toBeInstanceOf(PhotoAuthError);

    vi.stubGlobal("fetch", respond(503, { error: "mault_unavailable" }));
    await expect(identifyPhoto(photo, "tok")).rejects.toThrow(
      new PhotoUnavailableError("photo recognition is offline on the server"),
    );
  });

  it("says plainly when the server predates the route", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Cannot POST", { status: 404 })));
    await expect(identifyPhoto(photo, "tok")).rejects.toThrow(/does not support photos yet/);
  });

  it("treats an unreachable server as unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(identifyPhoto(photo, "tok")).rejects.toBeInstanceOf(PhotoUnavailableError);
  });
});

describe("toPhotoScanResult", () => {
  it("keeps an ambiguous answer unsettled, with every candidate and its score", () => {
    const result = toPhotoScanResult(AMBIGUOUS);
    expect(result.confident).toBe(false);
    expect(result.candidates.map((c) => c.card.id)).toEqual(["g1-56", "xy8-117"]);
    expect(result.candidates[1].confidence).toBe(0.999);
    expect(result.reason).toMatch(/check the number/);
  });

  it("prefers the local index's card, which carries rarity", () => {
    const index = {
      version: "x",
      hashes: new Uint32Array(2),
      cards: [
        {
          id: "sv1-1",
          name: "Pineco",
          number: "1",
          setId: "sv1",
          setName: "Scarlet & Violet",
          rarity: "Common",
        },
      ],
    } as CardIndex;
    expect(toPhotoScanResult(MATCHED, index).candidates[0].card.rarity).toBe("Common");
  });

  it("is never confident with nothing to offer", () => {
    expect(toPhotoScanResult({ ...MATCHED, candidates: [] }).confident).toBe(false);
  });

  it("passes on whether the server found the card's outline, and says so when it cannot tell", () => {
    const outline = {
      topLeft: { x: 0.2, y: 0.1 },
      topRight: { x: 0.8, y: 0.1 },
      bottomRight: { x: 0.8, y: 0.9 },
      bottomLeft: { x: 0.2, y: 0.9 },
    };
    expect(toPhotoScanResult({ ...MATCHED, outlineFound: true, outline })).toMatchObject({
      outlineFound: true,
      outline,
    });
    expect(toPhotoScanResult({ ...AMBIGUOUS, outlineFound: false, outline: null }).outlineFound).toBe(false);
    // An older server says nothing: that is "cannot tell", not "no outline".
    expect(toPhotoScanResult(AMBIGUOUS)).toMatchObject({ outlineFound: null, outline: null });
  });

  it("keeps an unscored guess unscored rather than calling it 0%", () => {
    const result = toPhotoScanResult({
      ...AMBIGUOUS,
      candidates: [{ ...AMBIGUOUS.candidates[0], confidence: null }],
    });
    expect(result.candidates[0].confidence).toBeNull();
    expect(result.confident).toBe(false);
  });
});
