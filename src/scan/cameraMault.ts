import type { CardIndex, ScanResult } from "./cardIndex.ts";
import { hamming } from "./phash.ts";

/**
 * A second opinion for the camera scanner: what Mault says about a capture the
 * artwork hash could not settle.
 *
 * The camera path is phash first (`/api/recognize`, device fallback), and a
 * confident phash answer ends there. The rest come back "Which one?". For those
 * the scan screen sends a native-resolution crop of the guide to Mault
 * (`/api/cards/identify`, the photo engine) and this decides what the row shows.
 *
 * **Mault can only CONFIRM, never overrule, and never on a reprint.** The row
 * auto-accepts only when all of these hold (measured on the guide-crop eval,
 * docs/scanner.md):
 *
 * 1. Mault is confident by its own gate (`judgeMault`, server-side);
 * 2. its card is one phash already offered;
 * 3. no OTHER card on the row (phash's or Mault's) shares its name; and
 * 4. the card has no same-name look-alike in the index (`LOOKALIKE_BITS`).
 *
 * 1+2 alone filed the wrong card twice in 444 captures — `cel25c-93_A` as
 * `ex15-93`, `tk2a-5` as `ex8-40` — because Mault's collection lacks one of
 * each reprint pair, so its runner-up test had no rival to see and it was
 * "99% sure" of the twin it did know. 3+4 refuse exactly that shape: a card
 * reprinted with the same art. Those stay "Which one?", with the collector
 * number shown, which is where a human is faster and never wrong. Mault alone,
 * however strict its threshold, leaked on the same pairs.
 *
 * Anything else — Mault unsure, disagreeing, offline — leaves the row asking,
 * with both lists merged so a card only Mault thought of is one tap away.
 */

/** Options offered on an unsettled row: phash's three plus what Mault adds. */
export const MERGED_CANDIDATES = 5;

/**
 * A same-name card whose artwork hash is this close is treated as a reprint of
 * it, which Mault is not trusted to separate. Perfect-capture ambiguity tops out
 * at 7 bits (the gate's margin); 8, 12 and 16 measured identical false-accept
 * counts (zero) and 12 costs nothing over 8, so it sits with headroom.
 */
export const LOOKALIKE_BITS = 12;

export interface MaultOpinion {
  /** Mault's gate passed (`IdentifyReply.status === "MATCHED"`). */
  confident: boolean;
  candidates: ScanResult["candidates"];
  reason: string;
}

export interface Combined {
  result: ScanResult;
  /** Mault confirmed phash's candidate and the row is now settled. */
  confirmed: boolean;
  reason: string;
}

/** Same comparison as the server's id-translation guard: punctuation-free, one may extend the other. */
function sameName(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const [x, y] = [norm(a), norm(b)];
  return x.length > 0 && y.length > 0 && (x.startsWith(y) || y.startsWith(x));
}

/**
 * "Does this card have a same-art reprint?", answered from the loaded index.
 * Unknown ids answer yes: a card the index cannot vouch for is never confirmed.
 */
export function lookalikesIn(index: CardIndex, bits = LOOKALIKE_BITS): (cardId: string) => boolean {
  let ordinals: Map<string, number> | null = null;
  return (cardId) => {
    ordinals ??= new Map(index.cards.map((c, i) => [c.id, i]));
    const i = ordinals.get(cardId);
    if (i === undefined) return true;
    const name = index.cards[i].name;
    for (let j = 0; j < index.cards.length; j++) {
      if (
        j !== i &&
        sameName(name, index.cards[j].name) &&
        hamming(index.hashes, 2 * i, index.hashes, 2 * j) <= bits
      )
        return true;
    }
    return false;
  };
}

export function combineWithMault(
  phash: ScanResult,
  mault: MaultOpinion,
  hasLookalike: (cardId: string) => boolean,
): Combined {
  const byMault = new Map(mault.candidates.map((c) => [c.card.id, c]));
  // Mault's order first only when it is sure; otherwise phash's (whose
  // candidates are what the hash actually saw) and Mault's extras after.
  const ordered = mault.confident
    ? [...mault.candidates, ...phash.candidates]
    : [...phash.candidates, ...mault.candidates];
  const seen = new Set<string>();
  const merged = ordered
    .filter((c) => (seen.has(c.card.id) ? false : (seen.add(c.card.id), true)))
    // A card both named keeps Mault's score, which reads as "97% match"; the
    // hash distance is not comparable with it anyway.
    .map((c) => {
      const m = byMault.get(c.card.id);
      return m ? { ...c, confidence: m.confidence } : c;
    });

  const top = mault.candidates[0];
  const offeredByPhash = top !== undefined && phash.candidates.some((c) => c.card.id === top.card.id);
  const reprint =
    top !== undefined &&
    (merged.some((c) => c.card.id !== top.card.id && sameName(c.card.name, top.card.name)) ||
      hasLookalike(top.card.id));
  const confirmed = mault.confident && offeredByPhash && !reprint;

  const candidates = merged.slice(0, MERGED_CANDIDATES);
  if (confirmed && candidates[0]?.card.id !== top.card.id) {
    // Mault's order is first when it is confident, so this only guards a
    // future reordering: the row pre-chooses index 0.
    const i = candidates.findIndex((c) => c.card.id === top.card.id);
    candidates.unshift(...candidates.splice(i, 1));
  }

  return {
    result: {
      match: candidates[0] ? { ordinal: 0, distance: candidates[0].distance } : null,
      runnerUp: candidates[1] ? { ordinal: 1, distance: candidates[1].distance } : null,
      confident: confirmed,
      candidates,
    },
    confirmed,
    reason: confirmed
      ? `artwork and Mault agree · ${mault.reason}`
      : mault.confident && reprint && offeredByPhash
        ? "reprinted with the same art — check the number"
        : mault.confident
          ? "Mault named a card the artwork didn't — pick the right one"
          : mault.reason,
  };
}
