import type { CardIndex, IndexedCard, ScanResult } from "./cardIndex.ts";
import { apiBaseUrl } from "../services/sync/http.ts";

/**
 * Recognition against the server instead of the device.
 *
 * The Python recogniser on SERVER-PC runs a bit-exact port of `phash.ts`
 * against the same index file, so today this answers identically to
 * `identify()` — the parity test in that service exists to keep it that way.
 * What it buys is a recogniser that can be **upgraded without reshipping the
 * app**: a larger index, better hashing, card detection. None of that fits in a
 * 13KB static asset.
 *
 * **OCR is the exception, and the exception is structural.** `recogniseRemote`
 * uploads the SAME 245x342 canvas the hash was taken from, deliberately, so the
 * server hashes exactly what the device would have. A collector number is about
 * 2.5% of card height — roughly 8px at that size, below every OCR engine's
 * floor, and about 31px in the 886x1237 the guide crop actually holds. So the
 * server can be given the OCR *logic* alone, but never the *pixels*: reading
 * the number requires the client to send a second, native-resolution crop, and
 * that is a Pages deploy. Measured 2026-08-28; do not scope OCR as server-only. *
 * What it costs is a round trip and a dependency on a machine that has been
 * found powered off twice. So this is never the only path — the caller keeps
 * the on-device index loaded and falls back to it, which is why the errors
 * below distinguish "the server said no" from "the server did not answer".
 */

/** One candidate as the Python service reports it. */
export interface RemoteCandidate {
  cardId: string;
  name: string;
  setId: string;
  setName: string;
  collectorNumber: string;
  distance: number;
  artworkScore: number;
}

export interface RemoteReply {
  status: "MATCHED" | "AMBIGUOUS" | "UNKNOWN";
  card: RemoteCandidate | null;
  confidence: number;
  margin: number;
  reason: string;
  candidates: RemoteCandidate[];
  indexVersion: string;
  processingTimeMs: number;
}

/** A remote answer, in the shape the scan screen already renders. */
export interface RemoteScanResult extends ScanResult {
  /** The service's own words for why it decided that — shown in review. */
  reason: string;
  margin: number;
  indexVersion: string;
  processingTimeMs: number;
}

/**
 * The token was missing or refused.
 *
 * Separated because it stays broken until someone types a new one, exactly as
 * sync treats 401. Retrying is pointless and falling back silently would hide
 * the fact that server recognition is not actually running.
 */
export class RecogniserAuthError extends Error {
  constructor(message = "the server rejected this device's token") {
    super(message);
    this.name = "RecogniserAuthError";
  }
}

/** Down, throttled, timed out, or unreachable — fall back and carry on. */
export class RecogniserUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecogniserUnavailableError";
  }
}

/**
 * Longer than sync's 20s would be pointless: the recogniser answers in ~110ms
 * and the rest is the tunnel. A scan that takes three seconds has already lost
 * to the local index, so this exists to fail over quickly, not to wait.
 */
export const RECOGNISE_TIMEOUT_MS = 6_000;

/** Kept equal to the `k` the on-device `identify()` is called with. */
const CANDIDATES = 3;

/**
 * PNG, not JPEG.
 *
 * The capture is already normalised to 245x342 — the size every index entry
 * was built at — so it is ~150KB either way at this resolution, and lossless
 * bytes mean the server hashes exactly what the device would have hashed.
 * That is what makes "server and device agree" a property you can test rather
 * than hope for; a JPEG round trip would put a plausible-looking discrepancy
 * between two implementations that are supposed to be identical.
 */
export function captureBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("the frame could not be encoded"))),
      "image/png",
    );
  });
}

/**
 * Ask the server what this card is.
 *
 * The index is optional and only improves the answer: the service reports a
 * card id, and resolving that against the locally loaded index recovers the
 * fields it does not send (rarity today, whatever is added later). A card the
 * server knows and the device does not still comes back fully usable — which
 * is the entire point of being able to grow the server's index alone.
 */
export async function recogniseRemote(
  canvas: HTMLCanvasElement,
  token: string,
  index: CardIndex | null = null,
): Promise<RemoteScanResult> {
  if (!token) throw new RecogniserAuthError("this device is not connected to the server");

  const body = new FormData();
  body.append("image", await captureBlob(canvas), "capture.png");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RECOGNISE_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/recognize`, {
      method: "POST",
      body,
      signal: controller.signal,
      // No content-type header: the browser must set it, because it is the only
      // thing that knows the multipart boundary it just generated.
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (err) {
    throw new RecogniserUnavailableError(
      err instanceof Error && err.name === "AbortError"
        ? "the server took too long"
        : "the server is unreachable",
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) throw new RecogniserAuthError();
  // 503 is both "sync disabled" (no COLLECTION_TOKEN set) and "recogniser
  // down". Neither is worth distinguishing on a scan path — both mean use the
  // device index for this card and try the server again on the next one.
  if (!res.ok) {
    throw new RecogniserUnavailableError(
      res.status === 429
        ? "the server is rate-limiting this device"
        : `the server answered HTTP ${res.status}`,
    );
  }

  let reply: RemoteReply;
  try {
    reply = (await res.json()) as RemoteReply;
  } catch {
    throw new RecogniserUnavailableError("the server sent something that was not a result");
  }
  if (!Array.isArray(reply?.candidates)) {
    throw new RecogniserUnavailableError("the server sent a result with no candidates");
  }

  return toScanResult(reply, index);
}

/** Map a service reply into the shape `ScanScreen` already knows how to draw. */
export function toScanResult(reply: RemoteReply, index: CardIndex | null = null): RemoteScanResult {
  const byId = new Map<string, IndexedCard>();
  for (const card of index?.cards ?? []) byId.set(card.id, card);

  // The service reports five; `identify()` reports three, and the review screen
  // turns them into buttons a human picks between. Five where the last three sit
  // twenty bits away is noise in the one place that has to stay quick to read —
  // and a picker whose length depends on which recogniser answered is a
  // difference the user would have to learn for no benefit.
  const candidates = reply.candidates.slice(0, CANDIDATES).map((c) => ({
    card: byId.get(c.cardId) ?? {
      id: c.cardId,
      name: c.name,
      number: c.collectorNumber,
      setId: c.setId,
      setName: c.setName,
      rarity: null,
    },
    distance: c.distance,
  }));

  // `ordinal` indexes the index locally; here it indexes `candidates`, which is
  // the only ordering that exists in a remote answer. Nothing downstream reads
  // it except to pair a match with its candidate, so the two agree where it
  // matters.
  return {
    match: candidates.length > 0 ? { ordinal: 0, distance: candidates[0].distance } : null,
    runnerUp: candidates.length > 1 ? { ordinal: 1, distance: candidates[1].distance } : null,
    // Trust the service's verdict rather than re-deriving it from distances:
    // the gate is its to own, and a future version that adds OCR will accept
    // pairs these numbers alone can never separate.
    confident: reply.status === "MATCHED",
    candidates,
    reason: reply.reason ?? "",
    margin: reply.margin ?? 0,
    indexVersion: reply.indexVersion ?? "",
    processingTimeMs: reply.processingTimeMs ?? 0,
  };
}
