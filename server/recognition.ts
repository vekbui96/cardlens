/**
 * Proxy to the card recognition service.
 *
 * The recogniser is a separate Python process on this machine (FastAPI, numpy,
 * and a 1,709-card perceptual-hash index). It listens on loopback only, so this
 * service — which already owns the shared token and the Tailscale Funnel — is
 * how anything reaches it. Nothing new is exposed publicly, and Funnel only
 * permits ports 443, 8443 and 10000 anyway, two of which are already spent.
 *
 * **This is NOT how the CardLens scanner works, and must not become it.**
 * `src/scan/phash.ts` recognises on the device: 164KB of index, a Hamming
 * distance over 20,460 integers, sub-millisecond, no network, works offline and
 * on the glasses. Routing that through a home server on residential upstream
 * would be slower, would need connectivity, and would answer exactly the same
 * question. This proxy exists for the card SORTER, whose machine cannot run a
 * browser, and for testing recognition from a phone against real photographs.
 *
 * Why a raw byte forward rather than a JSON relay like targetBot: the payload
 * is multipart/form-data, and parsing then re-encoding it would rewrite the
 * boundary and re-encode the image. The bytes are passed through untouched.
 */

const RECOGNITION_URL = (process.env.RECOGNITION_URL ?? "http://127.0.0.1:8200").replace(/\/$/, "");

/**
 * Generous against a phone photo, mean against anything else. The recogniser
 * caps uploads itself at 15MB; this is the outer bound so a hostile body is
 * refused before it is buffered rather than after.
 */
export const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

/**
 * Hashing is ~20ms and the index load is done at boot, so a slow answer here
 * means the process is wedged rather than working hard. Short on purpose: the
 * sorter's control loop cannot wait, and a human wants to know it is broken.
 */
const TIMEOUT_MS = 30_000;

export interface RecognitionReply {
  status: number;
  body: unknown;
}

/**
 * Forward one image. Never throws: a stopped recogniser is an ordinary state
 * this service reports as 503, not an exception the route has to catch. The
 * distinction matters — "recogniser offline" is actionable, a 500 is not.
 */
export async function callRecogniser(body: Buffer, contentType: string): Promise<RecognitionReply> {
  try {
    const res = await fetch(`${RECOGNITION_URL}/internal/v1/recognize`, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // The recogniser answers JSON. Anything else means it fell over in a way
      // it did not anticipate, and forwarding the raw text would leak a Python
      // traceback to a public endpoint.
      return { status: 502, body: { error: "recognition_bad_response" } };
    }
    return { status: res.status, body: parsed };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      status: 503,
      body: { error: timedOut ? "recognition_timeout" : "recognition_unavailable" },
    };
  }
}

/** Liveness, for the status line — separated so a UI can say "offline" before uploading. */
export async function recogniserHealth(): Promise<RecognitionReply> {
  try {
    const res = await fetch(`${RECOGNITION_URL}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    return { status: res.status, body: await res.json() };
  } catch {
    return { status: 503, body: { ok: false, error: "recognition_unavailable" } };
  }
}
