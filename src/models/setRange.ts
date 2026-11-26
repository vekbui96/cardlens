/**
 * "Whole set" on Add many: a range such as `1-50` becomes card numbers, and
 * the numbers become lines for the same list parser the paste box uses.
 * Pure text; whether the set has those numbers is the preview's question.
 */

export const MAX_RANGE = 1000;

export type RangeResult = { ok: true; numbers: number[] } | { ok: false; reason: string };

export function expandRange(text: string): RangeResult {
  const m = /^\s*(\d{1,5})\s*(?:[-–—]\s*(\d{1,5}))?\s*$/.exec(text);
  if (!m) return { ok: false, reason: "Type a range such as 1-50, or one number." };
  const a = Number(m[1]);
  const b = m[2] === undefined ? a : Number(m[2]);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (lo < 1) return { ok: false, reason: "Card numbers start at 1." };
  if (hi - lo + 1 > MAX_RANGE) return { ok: false, reason: `A range can hold at most ${MAX_RANGE} cards.` };
  return { ok: true, numbers: Array.from({ length: hi - lo + 1 }, (_, i) => lo + i) };
}

/** One `<set> <number>` line per number. */
export function rangeToLines(setCode: string, numbers: readonly number[]): string {
  return numbers.map((n) => `${setCode} ${n}`).join("\n");
}
