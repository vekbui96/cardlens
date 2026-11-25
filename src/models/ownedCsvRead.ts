/**
 * Reads the CSV that `ownedToCsv` writes (name,set,number,finish,price) back into
 * lines for `parseCardList`. The price column is ignored: the preview prices
 * each card from the catalog, and an unknown price stays "unpriced".
 *
 * Output lines sit on the same line number as their CSV record, so the
 * "Not recognised" list points at the row in the spreadsheet.
 */

export interface CsvProblem {
  line: number;
  raw: string;
  reason: string;
}

export interface OwnedCsvRead {
  /** Card-list text, one line per readable row, blank where a row was not readable. */
  text: string;
  problems: CsvProblem[];
  /** Data rows seen (readable or not). */
  rows: number;
}

/** The finish labels `finishLabel` writes, as words the list parser accepts. */
const LABEL_TO_WORD: Record<string, string> = {
  normal: "normal",
  "reverse holo": "reverse",
  holofoil: "holo",
  "1st edition": "1st",
};

interface Record_ {
  line: number;
  cells: string[];
  raw: string;
}

function readRecords(text: string): Record_[] {
  const out: Record_[] = [];
  let cells: string[] = [];
  let cur = "";
  let quoted = false;
  let line = 1;
  let start = 1;
  let startIdx = 0;
  const push = (end: number): void => {
    cells.push(cur);
    if (cells.some((c) => c.trim() !== ""))
      out.push({ line: start, cells, raw: text.slice(startIdx, end).trim() });
    cells = [];
    cur = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === "\n") line++;
        cur += ch;
      }
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      push(i);
      line++;
      start = line;
      startIdx = i + 1;
    } else cur += ch;
  }
  push(text.length);
  return out;
}

export function readOwnedCsv(
  csv: string,
  resolveSetCode: (setName: string) => string | undefined,
): OwnedCsvRead {
  const records = readRecords(csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv);
  const header = records[0]?.cells.map((c) => c.trim().toLowerCase()) ?? [];
  const col = (name: string): number => header.indexOf(name);
  const [iSet, iNumber, iFinish] = [col("set"), col("number"), col("finish")];
  if (iSet < 0 || iNumber < 0 || iFinish < 0) {
    return {
      text: "",
      rows: 0,
      problems: [
        {
          line: records[0]?.line ?? 1,
          raw: records[0]?.raw ?? "",
          reason: "Expected the columns name, set, number, finish, price (the owned-cards CSV).",
        },
      ],
    };
  }

  const lines: string[] = [];
  const problems: CsvProblem[] = [];
  for (const r of records.slice(1)) {
    const setName = (r.cells[iSet] ?? "").trim();
    const number = (r.cells[iNumber] ?? "").trim();
    const finishLabel = (r.cells[iFinish] ?? "").trim();
    const bad = (reason: string): void => {
      problems.push({ line: r.line, raw: r.raw, reason });
    };
    if (!number) {
      bad("This row has no card number.");
      continue;
    }
    const setCode = setName ? resolveSetCode(setName) : undefined;
    if (!setCode) {
      bad(setName ? `No set named ${setName}.` : "This row has no set.");
      continue;
    }
    let word = "";
    if (finishLabel) {
      const w = LABEL_TO_WORD[finishLabel.toLowerCase()];
      if (!w) {
        bad(`The printing ${finishLabel} cannot be imported yet.`);
        continue;
      }
      word = ` ${w}`;
    }
    lines[r.line - 1] = `${setCode} ${number}${word}`;
  }
  return {
    text: Array.from(lines, (l) => l ?? "").join("\n"),
    problems,
    rows: records.length - 1,
  };
}
