import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RecogniserAuthError,
  RecogniserUnavailableError,
  recogniseRemote,
  toScanResult,
  type RemoteReply,
} from "./remoteRecognize.ts";
import type { CardIndex, IndexedCard } from "./cardIndex.ts";

/** jsdom has no canvas encoder; only `toBlob` is ever called on it. */
function fakeCanvas(): HTMLCanvasElement {
  return {
    toBlob: (cb: (b: Blob | null) => void) =>
      cb(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })),
  } as unknown as HTMLCanvasElement;
}

function candidate(id: string, name: string, distance: number) {
  return {
    cardId: id,
    name,
    setId: id.split("-")[0],
    setName: "White Flare",
    collectorNumber: id.split("-")[1],
    distance,
    artworkScore: 1 - distance / 64,
  };
}

const MATCHED: RemoteReply = {
  status: "MATCHED",
  card: candidate("rsv10pt5-1", "Sewaddle", 0),
  confidence: 1,
  margin: 20,
  reason: "0 bits from the capture, 20 clear of the runner-up.",
  candidates: [candidate("rsv10pt5-1", "Sewaddle", 0), candidate("me2pt5-32", "N's Darumaka", 20)],
  indexVersion: "28a22623",
  processingTimeMs: 107.6,
};

function reply(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("toScanResult", () => {
  it("maps a match, its runner-up and the service's reasoning", () => {
    const result = toScanResult(MATCHED);
    expect(result.confident).toBe(true);
    expect(result.match).toEqual({ ordinal: 0, distance: 0 });
    expect(result.runnerUp).toEqual({ ordinal: 1, distance: 20 });
    expect(result.margin).toBe(20);
    expect(result.candidates[0].card.name).toBe("Sewaddle");
    expect(result.candidates[0].card.number).toBe("1");
  });

  it("refuses an ambiguous verdict even when the distance is zero", () => {
    // The reprint case: identical artwork, so distance alone says "certain".
    // Only the service's own status carries the refusal.
    const result = toScanResult({
      ...MATCHED,
      status: "AMBIGUOUS",
      margin: 0,
      candidates: [candidate("rsv10pt5-85", "Tool Scrapper", 0), candidate("me2pt5-212", "Tool Scrapper", 0)],
    });
    expect(result.confident).toBe(false);
    expect(result.candidates).toHaveLength(2);
  });

  it("shows the same number of candidates as the device would", () => {
    // The service reports five; the picker is built for three, and a list whose
    // length depends on which recogniser answered is a difference to learn for
    // no benefit.
    const five = [0, 20, 21, 22, 23].map((d, i) => candidate(`me5-${i}`, `Card ${i}`, d));
    expect(toScanResult({ ...MATCHED, candidates: five }).candidates).toHaveLength(3);
  });

  it("has no match at all when nothing resembled the capture", () => {
    const result = toScanResult({ ...MATCHED, status: "UNKNOWN", card: null, candidates: [] });
    expect(result.match).toBeNull();
    expect(result.runnerUp).toBeNull();
    expect(result.confident).toBe(false);
  });

  it("prefers the local index entry, so fields the server omits survive", () => {
    const card: IndexedCard = {
      id: "rsv10pt5-1",
      name: "Sewaddle",
      number: "1",
      setId: "rsv10pt5",
      setName: "White Flare",
      rarity: "Common",
    };
    const index: CardIndex = { version: "28a22623", hashes: new Uint32Array(2), cards: [card] };
    expect(toScanResult(MATCHED, index).candidates[0].card.rarity).toBe("Common");
  });

  it("still answers for a card the server knows and the device does not", () => {
    // The reason for routing to the server at all: its index can grow alone.
    const index: CardIndex = { version: "28a22623", hashes: new Uint32Array(0), cards: [] };
    const result = toScanResult(MATCHED, index);
    expect(result.candidates[0].card.id).toBe("rsv10pt5-1");
    expect(result.candidates[0].card.rarity).toBeNull();
  });
});

describe("recogniseRemote", () => {
  it("posts multipart and lets the browser set its own boundary", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(200, MATCHED));
    vi.stubGlobal("fetch", fetchMock);

    const result = await recogniseRemote(fakeCanvas(), "sekrit");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/recognize$/);
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sekrit");
    // A content-type here would carry the wrong boundary and the server would
    // read an empty body.
    expect(Object.keys(init.headers as object).map((k) => k.toLowerCase())).not.toContain("content-type");
    expect(result.confident).toBe(true);
  });

  it("refuses to send anything without a token", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(recogniseRemote(fakeCanvas(), "")).rejects.toBeInstanceOf(RecogniserAuthError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a rejected token as permanent, not as being offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(401, { error: "unauthorized" })));
    await expect(recogniseRemote(fakeCanvas(), "wrong")).rejects.toBeInstanceOf(RecogniserAuthError);
  });

  it.each([
    [503, "unavailable"],
    [502, "bad gateway"],
    [429, "rate limited"],
  ])("treats HTTP %i as fall-back-to-device", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(status, { error: "nope" })));
    await expect(recogniseRemote(fakeCanvas(), "sekrit")).rejects.toBeInstanceOf(RecogniserUnavailableError);
  });

  it("treats an unreachable server as fall-back-to-device", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(recogniseRemote(fakeCanvas(), "sekrit")).rejects.toBeInstanceOf(RecogniserUnavailableError);
  });

  it("does not accept a 200 that is not a recognition result", async () => {
    // A tunnel that answers with an HTML error page is still a 200.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, { nonsense: true })));
    await expect(recogniseRemote(fakeCanvas(), "sekrit")).rejects.toBeInstanceOf(RecogniserUnavailableError);
  });
});
