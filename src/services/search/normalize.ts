/**
 * Turn a raw user query into a structured search intent. Handles the cases in the
 * spec: "Charizard", "Charizard ex", "Pikachu 025", "Charizard 4/102",
 * "Umbreon VMAX", "Greninja ex".
 */
export interface NormalizedQuery {
  raw: string;
  /** Cleaned, lowercased full text. */
  text: string;
  /** Name portion (number removed), lowercased. */
  name: string;
  /** Collector number digits if present (e.g. "25" from "025" or "4/102"). */
  collectorNumber?: string;
  /** Set total if the "n/m" form was used (e.g. "102" from "4/102"). */
  setTotal?: string;
  /** Suffix token like ex / v / vmax / vstar / gx if present. */
  suffix?: string;
}

const SUFFIX_TOKENS = new Set(["ex", "gx", "v", "vmax", "vstar", "v-union", "vunion"]);

export function stripLeadingZeros(value: string): string {
  const stripped = value.replace(/^0+/, "");
  return stripped.length ? stripped : "0";
}

export function normalizeQuery(raw: string): NormalizedQuery {
  const text = raw.toLowerCase().trim().replace(/\s+/g, " ");

  let working = text;
  let collectorNumber: string | undefined;
  let setTotal: string | undefined;

  // "4/102" or "223 / 197"
  const fraction = working.match(/(\d+)\s*\/\s*(\d+)/);
  if (fraction) {
    collectorNumber = stripLeadingZeros(fraction[1]);
    setTotal = stripLeadingZeros(fraction[2]);
    working = working.replace(fraction[0], " ").trim();
  } else {
    // standalone number token (e.g. "pikachu 025")
    const standalone = working.match(/(?:^|\s)(\d{1,4})(?=$|\s)/);
    if (standalone) {
      collectorNumber = stripLeadingZeros(standalone[1]);
      working = working.replace(standalone[0], " ").trim();
    }
  }

  const tokens = working.split(" ").filter(Boolean);
  const suffix = tokens.find((t) => SUFFIX_TOKENS.has(t));
  const name = tokens.join(" ").trim();

  return {
    raw,
    text,
    name,
    ...(collectorNumber ? { collectorNumber } : {}),
    ...(setTotal ? { setTotal } : {}),
    ...(suffix ? { suffix } : {}),
  };
}
