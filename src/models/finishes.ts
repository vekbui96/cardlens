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

/**
 * Foils that are the same print run as their base type, and so may borrow its
 * price when no price of their own exists.
 *
 * These are PATTERNS pressed into an ordinary card: a Poké Ball reverse and a
 * plain reverse come out of the same packs in the same numbers, and providers
 * do not model them separately, so falling back is the only way to price them
 * at all.
 *
 * A STAMP is not this. A staff promo, a Comic-Con stamp, a Burger King Lucario
 * or a League prize is a different, usually far scarcer object that happens to
 * share a collector number with the card underneath it. Pricing one at the base
 * card's price is not an approximation, it is a made-up number — and it looked
 * exactly like a real one in the binder total until a staff-stamped Umbreon
 * VMAX priced itself at $2.4k.
 *
 * Unknown foils are deliberately NOT in this set. A new ball foil will read
 * "n/a" until it is added here, which is a visible gap; the alternative is a
 * confident wrong price, which is not.
 */
const PATTERN_FOILS = new Set([
  "pokeball",
  "masterball",
  "friendball",
  "loveball",
  "quickball",
  "team-rocket",
  "energy",
  "cosmos",
  "tinsel",
  "cracked-ice",
]);

/** May this printing take its base type's price when it has none of its own? */
export function pricesAsBaseType(finish: Finish): boolean {
  const { foil } = parseFinish(finish);
  return foil ? PATTERN_FOILS.has(foil) : false;
}

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
 * The printing a single mark should actually write for a card.
 *
 * The picker is set-wide but printings are per-card, and moving focus does not
 * re-resolve it — ← → skips printings the focused card lacks, moving up and down
 * does not. So sitting on a holo card, stepping down to one that has no holo,
 * and pinching used to write `holo` onto a card that does not have it.
 *
 * That is worse than a display glitch: the phantom row inflates the owned count
 * past the set's real denominator, syncs to every device, and then joins the
 * picker's choices for the whole set, because anything already held stays
 * selectable.
 *
 * Prefers the active printing, then one of the same type (Poké Ball Reverse ->
 * Reverse rather than Normal), then the card's most basic printing. It never
 * returns something the card does not have, unless nothing is known about the
 * card at all — in which case the caller's guess is the only thing available.
 *
 * Doing nothing was the other option and is worse on the glasses: a pinch that
 * silently no-ops is indistinguishable from hardware that did not register it.
 *
 * `available` is null when nothing vouches for the card's printings — see
 * knownFinishes. Then the picker is the only real signal of intent, and it is
 * taken at its word: overriding an explicit choice with a padded default is
 * what wrote `normal` onto holo-only cards.
 */
export function finishToMark(available: Finish[] | null, active: Finish): Finish {
  if (!available || available.length === 0) return active;
  if (available.includes(active)) return active;
  const { type } = parseFinish(active);
  const sameType = available.filter((f) => parseFinish(f).type === type);
  return [...(sameType.length > 0 ? sameType : available)].sort(compareFinishes)[0];
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
