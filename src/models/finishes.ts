/**
 * A printing of a card, as a single string key: `type` or `type:foil`.
 *
 *   normal            reverse            holo
 *   reverse:pokeball  reverse:masterball reverse:energy
 *   holo:tinsel       firstEdition       shadowless
 *
 * Why a string rather than a { type, foil } record: it is the key of the
 * collection's OR-Set, so keeping it a scalar means rows never change shape,
 * sync payloads stay flat, and the server can validate by pattern.
 *
 * Why a pattern and not an enum: sets invent foils. Three 2025-26 sets alone
 * introduced pokeball, masterball, tinsel, cosmos, energy, friendball,
 * loveball, quickball and team-rocket. Anything hardcoded is wrong by the next
 * release, so unknown foils are accepted and labelled generically.
 */
export type Finish = string;

/** Canonical printing types. Foils attach to these. */
export const FINISH_TYPES = ["normal", "reverse", "holo", "firstEdition", "shadowless"] as const;

export interface ParsedFinish {
  type: string;
  foil?: string;
}

export function makeFinish(type: string, foil?: string): Finish {
  return foil ? `${type}:${foil}` : type;
}

export function parseFinish(finish: Finish): ParsedFinish {
  const i = finish.indexOf(":");
  if (i < 0) return { type: finish };
  return { type: finish.slice(0, i), foil: finish.slice(i + 1) };
}

/**
 * Legacy values from before printings were modelled as type+foil. Migrated on
 * read so no stored row has to be rewritten.
 */
const LEGACY: Record<string, Finish> = {
  holofoil: "holo",
  reverseHolofoil: "reverse",
  pokeBall: "reverse:pokeball",
  masterBall: "reverse:masterball",
};

export function canonicalFinish(raw: string): Finish {
  return LEGACY[raw] ?? raw;
}

const TYPE_LABELS: Record<string, string> = {
  normal: "Normal",
  reverse: "Reverse Holo",
  holo: "Holofoil",
  firstEdition: "1st Edition",
  shadowless: "Shadowless",
  wPromo: "Promo",
};

const FOIL_LABELS: Record<string, string> = {
  pokeball: "Poké Ball",
  masterball: "Master Ball",
  friendball: "Friend Ball",
  loveball: "Love Ball",
  quickball: "Quick Ball",
  "team-rocket": "Team Rocket",
  energy: "Energy",
  cosmos: "Cosmos",
  tinsel: "Tinsel",
};

/** Turn an unknown foil into something readable rather than showing a raw key. */
function humanize(raw: string): string {
  const spaced = raw.replace(/[-_]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function finishLabel(finish: Finish): string {
  const { type, foil } = parseFinish(finish);
  const typeLabel = TYPE_LABELS[type] ?? humanize(type);
  if (!foil) return typeLabel;
  const foilLabel = FOIL_LABELS[foil] ?? humanize(foil);
  // "Poké Ball Reverse" reads better than "Reverse Holo — Poké Ball" in a list.
  return type === "reverse" ? `${foilLabel} Reverse` : `${typeLabel} — ${foilLabel}`;
}

const TYPE_SHORT: Record<string, string> = {
  normal: "N",
  reverse: "RH",
  holo: "H",
  firstEdition: "1st",
  shadowless: "SL",
};

const FOIL_SHORT: Record<string, string> = {
  pokeball: "PB",
  masterball: "MB",
  friendball: "FB",
  loveball: "LB",
  quickball: "QB",
  "team-rocket": "TR",
  energy: "EN",
  cosmos: "CO",
  tinsel: "TI",
};

/** Two-or-three character badge for list rows. */
export function finishShort(finish: Finish): string {
  const { type, foil } = parseFinish(finish);
  if (!foil) return TYPE_SHORT[type] ?? type.slice(0, 2).toUpperCase();
  return FOIL_SHORT[foil] ?? foil.slice(0, 2).toUpperCase();
}

/**
 * Ordering for pickers and badge rows: plain printings first, then patterns.
 * Stable so the picker does not reshuffle as data arrives.
 */
const TYPE_ORDER = ["normal", "reverse", "holo", "firstEdition", "shadowless"];

export function compareFinishes(a: Finish, b: Finish): number {
  const pa = parseFinish(a);
  const pb = parseFinish(b);
  // Unpatterned before patterned.
  if (Boolean(pa.foil) !== Boolean(pb.foil)) return pa.foil ? 1 : -1;
  const ia = TYPE_ORDER.indexOf(pa.type);
  const ib = TYPE_ORDER.indexOf(pb.type);
  if (ia !== ib) return (ia < 0 ? TYPE_ORDER.length : ia) - (ib < 0 ? TYPE_ORDER.length : ib);
  return (pa.foil ?? "").localeCompare(pb.foil ?? "");
}

/**
 * Printings rare enough within a set to be product exclusives rather than pack
 * pulls — measured, not guessed: in White Flare every pack printing appears on
 * 71-105 of 173 cards, while `holo:tinsel` appears on 2.
 *
 * The rule is "if you can pull it from a standard pack it counts", and nothing
 * in the data marks pack availability, so frequency is the available proxy.
 */
export const PACK_PRINTING_MIN_SHARE = 0.05;

export function isLikelyPackPrinting(cardsWithFinish: number, cardsInSet: number): boolean {
  if (cardsInSet <= 0) return false;
  return cardsWithFinish / cardsInSet >= PACK_PRINTING_MIN_SHARE;
}
