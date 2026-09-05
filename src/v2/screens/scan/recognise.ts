import { RecogniserAuthError } from "../../../scan/remoteRecognize.ts";
import type { ScanResult } from "../../../scan/cardIndex.ts";

/**
 * Who answers a capture, and what it means when the answer did not come from
 * where it was asked.
 *
 * Server-first, device-always — with ONE exception, and the exception is the
 * whole reason this is a module of its own rather than three lines inside a
 * component.
 *
 * A server that is **down** and a server that has **refused this device** look
 * identical to a scanner and mean opposite things. Down is weather: the local
 * index answers, the row says it answered, and the next card tries the server
 * again, because a stack takes minutes and a service restart takes seconds. A
 * refused token is a broken configuration that will still be broken on the
 * two-hundredth card, and quietly answering it on the device would file a whole
 * pile under a recogniser the user did not choose while the screen went on
 * claiming to use the server. So a rejected token falls back to NOTHING; the
 * screen says so and asks.
 *
 * Everything here is injected, so the decision can be tested without a camera,
 * a canvas or a network — which is the only way it ever gets tested at all.
 */

/** What answered, and what it had to say for itself. */
export type Answer =
  | {
      kind: "answered";
      via: "server" | "device";
      result: ScanResult;
      /** The service's reasoning, or why the device is answering instead. */
      note: string | null;
      /**
       * True when the server was asked and could not answer. Recorded per
       * capture, not per session: the engine can change mid-batch — one timeout
       * falls this card back and the next one reaches the server — so a single
       * banner would describe the wrong rows.
       */
      failedOver: boolean;
    }
  /** The server refused this device's token. Nothing answered, on purpose. */
  | { kind: "rejected"; note: string }
  /** No server and no index. Honest, and rare. */
  | { kind: "unanswerable"; note: string };

export interface Recognisers {
  /** The remote recogniser. Throws `RecogniserAuthError` on a refused token. */
  server: () => Promise<ScanResult & { reason?: string }>;
  /** The on-device index, or `null` while it has not loaded. */
  device: () => ScanResult | null;
}

export async function answerCapture(engine: "server" | "device", recognisers: Recognisers): Promise<Answer> {
  if (engine === "server") {
    try {
      const result = await recognisers.server();
      return {
        kind: "answered",
        via: "server",
        result,
        note: result.reason ? result.reason : null,
        failedOver: false,
      };
    } catch (err) {
      // The one failure that must not fall back. See the module comment.
      if (err instanceof RecogniserAuthError) {
        return { kind: "rejected", note: err.message };
      }
      const why = err instanceof Error ? err.message : "the server did not answer";
      const local = recognisers.device();
      if (!local) {
        return { kind: "unanswerable", note: `${why}, and no index has loaded on this device.` };
      }
      return {
        kind: "answered",
        via: "device",
        result: local,
        note: `${why} — recognised on this device`,
        failedOver: true,
      };
    }
  }

  const local = recognisers.device();
  if (!local) {
    return { kind: "unanswerable", note: "The card index has not loaded, so nothing can identify this." };
  }
  return { kind: "answered", via: "device", result: local, note: null, failedOver: false };
}
