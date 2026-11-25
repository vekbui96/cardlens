import type { Finish } from "./finishes.ts";

/**
 * Pure parser for a pasted card list, one card per line:
 * `SV3 125`, `sv3 125 x2`, `sv3 125 holo`.
 *
 * It only reads text. Whether the set code and number name a real card is the
 * preview screen's question (it has the catalog); nothing here is stored.
 */

export interface ParsedCardLine {
  ok: true;
  /** 1-based line in the pasted text, blanks counted. */
  line: number;
  raw: string;
  /** Upper-cased, as typed: a set code or an id such as `sv3`. */
  setCode: string;
  /** Collector number as typed (`125`, `101a`, `TG01`). */
  number: string;
  quantity: number;
  /** Only when a printing word was given. */
  finish?: Finish;
}

export interface BadCardLine {
  ok: false;
  line: number;
  raw: string;
  reason: string;
}

export type CardListLine = ParsedCardLine | BadCardLine;

export interface ParsedCardList {
  lines: CardListLine[];
  /** `SET NUMBER` pairs that appear on more than one line (the lines are kept as typed). */
  duplicates: string[];
}

/** Printing words a collector would type. Never an enum: the stored printing stays a string. */
const FINISH_WORDS: Record<string, Finish> = {
  normal: "normal",
  reverse: "reverse",
  holo: "holo",
  "1st": "firstEdition",
  "1stedition": "firstEdition",
  firstedition: "firstEdition",
};

const NUMBER = /^[A-Za-z]{0,3}\d{1,3}[A-Za-z]?$/;
const QUANTITY = /^(?:x(\d{1,3})|(\d{1,3})x)$/i;
const MAX_QUANTITY = 99;

export function parseCardList(text: string): ParsedCardList {
  const lines: CardListLine[] = [];
  const seen = new Map<string, number>();

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const raw = rawLine.trim();
    if (!raw) return;
    const line = index + 1;
    const bad = (reason: string): void => {
      lines.push({ ok: false, line, raw, reason });
    };

    const [setCode, number, ...rest] = raw.split(/\s+/);
    if (!number) return bad("Add a card number after the set code, e.g. SV3 125.");
    if (!/^[A-Za-z0-9-]{1,12}$/.test(setCode ?? "")) return bad("The set code looks wrong.");
    if (!NUMBER.test(number)) return bad(`"${number}" is not a card number.`);

    let quantity: number | null = null;
    let finish: Finish | null = null;
    for (const word of rest) {
      const q = QUANTITY.exec(word);
      if (q) {
        if (quantity !== null) return bad("Only one quantity per line.");
        quantity = Number(q[1] ?? q[2]);
        if (quantity < 1 || quantity > MAX_QUANTITY) {
          return bad(`Quantity must be 1 to ${MAX_QUANTITY}.`);
        }
        continue;
      }
      const f = FINISH_WORDS[word.toLowerCase()];
      if (!f) return bad(`"${word}" is not a quantity (x2) or a printing (normal, reverse, holo, 1st).`);
      if (finish !== null) return bad("Only one printing per line.");
      finish = f;
    }

    const code = setCode.toUpperCase();
    const key = `${code} ${number.toUpperCase()}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    lines.push({
      ok: true,
      line,
      raw,
      setCode: code,
      number,
      quantity: quantity ?? 1,
      ...(finish ? { finish } : {}),
    });
  });

  return { lines, duplicates: [...seen].filter(([, n]) => n > 1).map(([key]) => key) };
}
