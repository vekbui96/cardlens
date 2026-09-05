import type { CollectFinish } from "../../../models/cards.ts";
import type { IndexedCard, ScanResult } from "../../../scan/cardIndex.ts";
import type { Answer } from "./recognise.ts";

/**
 * The batch: what has been captured, what each row decided, and what gets
 * written at the end.
 *
 * Pure, and separate from the screen, because every rule that can actually lose
 * someone's collection lives here — which row counts as decided, what a row
 * commits, and the fact that committing only ever ADDS. None of that is
 * observable by looking at the markup, so none of it would be tested if it
 * stayed inside a component that needs a camera to mount.
 */

/** Which recogniser answered. `null` while the answer is still in flight. */
export type Via = "server" | "device" | null;

export interface Capture {
  key: number;
  /** What the camera actually saw, small. Reviewing names with no picture is guesswork. */
  thumb: string;
  /**
   * The collector-number strip, shown only when recognition could not decide.
   *
   * 2,042 of 20,205 cards cannot be told apart by artwork at all — genuine
   * reprints with identical art, where the printed number is the only thing
   * that separates them. Rather than READ it, which needs OCR and introduces a
   * way to file the wrong card silently, this puts the pixels in front of the
   * person who is already being asked "which one?".
   *
   * Released as soon as a row settles confidently, so a batch of thirty cards
   * does not hold thirty full-resolution crops it will never show.
   */
  numberBand: string | null;
  /** Null until an answer arrives. A round trip must not block the shutter. */
  result: ScanResult | null;
  via: Via;
  /** The service's reasoning, or why there is no result. */
  note: string | null;
  /** The device answered because the server could not. Per row, not per session. */
  failedOver: boolean;
  /** The server refused this device's token, and nothing else was asked. */
  tokenRejected: boolean;
  /** Index into candidates, or null when nothing has been chosen yet. */
  choice: number | null;
  /**
   * Named by hand, beside the result rather than over it.
   *
   * Keeping the candidates means changing your mind after correcting a row does
   * not mean rescanning the card.
   */
  manual: IndexedCard | null;
  finish: CollectFinish;
  rejected: boolean;
}

export function newCapture(key: number, thumb: string, numberBand: string): Capture {
  return {
    key,
    thumb,
    numberBand,
    result: null,
    via: null,
    note: null,
    failedOver: false,
    tokenRejected: false,
    choice: null,
    manual: null,
    finish: "normal",
    rejected: false,
  };
}

/** Fold an answer into the row it belongs to. */
export function applyAnswer(capture: Capture, answer: Answer): Capture {
  if (answer.kind === "rejected") {
    return { ...capture, result: null, via: null, note: answer.note, tokenRejected: true };
  }
  if (answer.kind === "unanswerable") {
    return { ...capture, result: null, via: null, note: answer.note };
  }
  const confident = answer.result.confident;
  return {
    ...capture,
    result: answer.result,
    via: answer.via,
    note: answer.note,
    failedOver: answer.failedOver,
    tokenRejected: false,
    // A confident match needs no decision; an unsure one must NOT be
    // pre-answered, or review degrades into rubber-stamping.
    choice: confident ? 0 : null,
    // A confident row will never show its band, so the crop is released here
    // rather than held for the life of the batch.
    numberBand: confident ? null : capture.numberBand,
  };
}

/** What this row will file, however it was decided. */
export function chosenOf(c: Capture): { card: IndexedCard; distance: number | null } | null {
  if (c.manual) return { card: c.manual, distance: null };
  if (c.choice === null || !c.result) return null;
  const candidate = c.result.candidates[c.choice];
  return candidate ? { card: candidate.card, distance: candidate.distance } : null;
}

/** Ready to commit: kept, and something was actually identified. */
export function isKept(c: Capture): boolean {
  return !c.rejected && chosenOf(c) !== null;
}

export interface CommitEntry {
  cardId: string;
  finish: CollectFinish;
  setId: string;
  number: string;
}

/**
 * The whole batch as one write.
 *
 * Marking one card at a time re-reads, merges, prunes and re-serialises the
 * entire collection per card — quadratic over a batch, which is exactly what a
 * scanner produces. And it is `addManyOwned`, never a toggle: a pile being
 * digitised overlaps what is already held, and toggling would un-mark precisely
 * the cards that were already there. Two copies of one card in a batch would
 * cancel out entirely.
 *
 * The collector number rides along. It costs nothing here and the collection's
 * tier split needs it on rows that predate the field.
 */
export function commitEntries(queue: Capture[]): CommitEntry[] {
  return queue.filter(isKept).flatMap((c) => {
    const chosen = chosenOf(c);
    if (!chosen) return [];
    return [
      {
        cardId: chosen.card.id,
        finish: c.finish,
        setId: chosen.card.setId,
        number: chosen.card.number,
      },
    ];
  });
}

export interface BatchSummary {
  total: number;
  /** Rows that will be written. */
  kept: number;
  /** Rows still waiting on a decision — they will be skipped, and we say so. */
  unsure: number;
  rejected: number;
}

export function batchSummary(queue: Capture[]): BatchSummary {
  return {
    total: queue.length,
    kept: queue.filter(isKept).length,
    unsure: queue.filter((c) => !c.rejected && chosenOf(c) === null).length,
    rejected: queue.filter((c) => c.rejected).length,
  };
}
