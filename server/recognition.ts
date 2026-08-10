/**
 * Proxy to the card recognition service.
 *
 * The recogniser is a separate Python process on this machine (FastAPI, numpy,
 * and a 20,205-card perceptual-hash index). It listens on loopback only, so this
 * service — which already owns the shared token and the Tailscale Funnel — is
 * how anything reaches it. Nothing new is exposed publicly, and Funnel only
 * permits ports 443, 8443 and 10000 anyway, two of which are already spent.
 *
 * Three callers now: the card SORTER, whose machine cannot run a browser; the
 * bench page, which is how recognition gets measured against real photographs
 * from a phone; and — since 2026-08-10 — the CardLens scanner itself.
 *
 * **The scanner's use of this is server-FIRST, never server-only.** It keeps
 * `src/scan/phash.ts` loaded and answers from the device whenever this route
 * does not: sub-millisecond, offline, and working when SERVER-PC is not. Today
 * the two give the same answer, because the Python hash is a line-by-line port
 * of the TypeScript one over the same index file and a parity test enforces it.
 * The reason to route here at all is that this side can be given a bigger
 * index, OCR disambiguation or card detection without reshipping a static
 * bundle to Pages — and 1,730 of 20,205 cards are unresolvable by artwork
 * alone, so that ceiling is real and already measured.
 *
 * If this proxy ever answers something the device would not, that is the point.
 * If it answers more SLOWLY than the device and nothing else, the scanner
 * should go back to being local-only.
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
