/**
 * The contract of `POST /api/cards/identify` — "what card is in this photo?".
 *
 * Shared with the server through `tsconfig.node.json`, so the route and the
 * scan screen cannot drift. Deliberately the same shape `/api/recognize`
 * answers with (status / card / candidates), so a photo row is drawn by the
 * same review code as a camera capture.
 *
 * Every id in here is a **pokemontcg.io** id that exists in CardLens's own card
 * index. The engine behind this route (Mault, self-hosted on SERVER-PC) speaks
 * TCGdex ids; the server translates them and DROPS any it cannot resolve, so the
 * client never sees an id it cannot file.
 */

export interface IdentifyCandidate {
  cardId: string;
  name: string;
  setId: string;
  setName: string;
  collectorNumber: string;
  /** The engine's embedding distance: smaller is closer. Not comparable with phash bits. */
  distance: number;
  /**
   * The engine's own 0..1 score for this candidate, independent per candidate.
   * Null when the engine named the card without scoring it (Mault's unsure
   * "diagnostic" list): a nearest guess, never something to pre-choose.
   */
  confidence: number | null;
}

/** A point as a fraction of the uploaded photo's width/height (0..1). */
export interface OutlinePoint {
  x: number;
  y: number;
}

/** Where the engine found the card in the photo, corner by corner. */
export interface CardOutline {
  topLeft: OutlinePoint;
  topRight: OutlinePoint;
  bottomRight: OutlinePoint;
  bottomLeft: OutlinePoint;
}

export interface IdentifyReply {
  /**
   * MATCHED: confident enough to pre-choose candidate 0 (still reviewable).
   * AMBIGUOUS: candidates to choose between. UNKNOWN: nothing resolvable.
   */
  status: "MATCHED" | "AMBIGUOUS" | "UNKNOWN";
  candidates: IdentifyCandidate[];
  /** Plain words for why, shown on the review row. */
  reason: string;
  /** Which engine answered. One today; named so a second one is not a guess. */
  recogniser: "mault";
  processingTimeMs: number;
  /**
   * Whether the engine found a card outline in the photo and straightened it.
   * `false` means it searched the whole picture as-is, which is when cropping
   * by hand helps. Absent when the engine cannot say (an un-patched Mault
   * without the `/cards/photo` route), so a client must not read absence as
   * "no outline".
   */
  outlineFound?: boolean;
  /**
   * The outline it used, when it used one. Null when it found none, or when
   * the whole photo matched better (it already was the card).
   */
  outline?: CardOutline | null;
}

/** The error bodies a client can act on. Anything else is "try again". */
export type IdentifyError =
  | "mault_unavailable"
  | "mault_timeout"
  | "mault_bad_response"
  | "expected_image"
  | "empty_body"
  | "image_too_large";
