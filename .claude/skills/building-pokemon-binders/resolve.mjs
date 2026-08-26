#!/usr/bin/env node
// Resolve a hand-written list of printings into binder slots.
//
//   node resolve.mjs <list.txt> [--out slots.json] [--cache ./cache]
//
// Input: one printing per line, "Name — Set Number — Printing", em-dash separated.
//   Riolu — Platinum 91/127 — Reverse Holo
//   Lucario ex — Scarlet & Violet Black Star Promo SVP 017 — Holo
//
// Output: a JSON array, one entry per LINE, in list order. Lines the catalog
// cannot name become `null` — the pocket stays empty so nothing after it shifts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const API = "https://api.pokemontcg.io/v2";
const UA = { "User-Agent": "cardlens-binder-builder" };
const PAGE = 250; // the API's maximum

const args = process.argv.slice(2);
const listPath = args.find((a) => !a.startsWith("--"));
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
if (!listPath) {
  console.error("usage: node resolve.mjs <list.txt> [--out slots.json] [--cache ./cache]");
  process.exit(1);
}
const outPath = flag("out", "slots.json");
const cacheDir = flag("cache", "./cache");
mkdirSync(cacheDir, { recursive: true });

/**
 * pokemontcg.io fails ~25% of the time, in BURSTS.
 *
 * Failures cluster in time rather than arriving independently, so a tight retry
 * lands inside the same burst and fails with it. Back off instead, and let the
 * disk cache carry the successes so a re-run only pays for what actually broke.
 */
async function get(url) {
  let last;
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (res.ok) return await res.json();
      last = new Error(`HTTP ${res.status}`);
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  throw last;
}

/**
 * Set ids are looked up BY NAME from the catalog, never hand-typed.
 *
 * Two hand-typed ids were wrong the first time this ran (Plasma Storm is bw8
 * not bw7; Supreme Victors is pl3 not pl4) and both resolved successfully to
 * real cards — the binder would have quietly gained a Gothita and a Sceptile.
 * The aliases below exist only where a collector's name for a set genuinely
 * differs from the catalog's.
 */
const ALIASES = {
  Unleashed: "HS—Unleashed",
  Undaunted: "HS—Undaunted",
  Triumphant: "HS—Triumphant",
  "BW Black Star Promo": "BW Black Star Promos",
  "XY Black Star Promo": "XY Black Star Promos",
  "SM Black Star Promo": "SM Black Star Promos",
  "SWSH Black Star Promo": "SWSH Black Star Promos",
  "DP Black Star Promo": "DP Black Star Promos",
  "Nintendo Black Star Promo": "Nintendo Black Star Promos",
  "Wizards Black Star Promo": "Wizards Black Star Promos",
  "Scarlet & Violet Black Star Promo": "Scarlet & Violet Black Star Promos",
  "Crown Zenith GG": "Crown Zenith Galarian Gallery",
  "Brilliant Stars TG": "Brilliant Stars Trainer Gallery",
  "Astral Radiance TG": "Astral Radiance Trainer Gallery",
  "Lost Origin TG": "Lost Origin Trainer Gallery",
  "Silver Tempest TG": "Silver Tempest Trainer Gallery",
  "Hidden Fates": "Hidden Fates Shiny Vault",
  "Shining Fates": "Shining Fates Shiny Vault",
};

const norm = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Printing name -> finish key.
 *
 * Two different things wear the same clothes. "Full Art" or "Shiny Rare" names
 * a RARITY, and the catalog gives it its own collector number — the number
 * already identifies it, so the finish is just `holo`. "Staff" or "Comic-Con
 * Stamp" names a STAMP on a card with no separate number, so it has to live in
 * the finish key or it cannot be told apart from the card it is stamped on.
 *
 * Finishes are `type` or `type:foil` and unknown foils are humanised for
 * display, which is what makes the second kind expressible without teaching the
 * app about every promo distribution Pokémon has ever run. Add rows freely;
 * never turn this into an enum.
 */
const FINISHES = {
  normal: "normal",
  "non-holo": "normal",
  holo: "holo",
  "holo rare": "holo",
  "reverse holo": "reverse",
  "cosmos holo": "holo:cosmos",
  "cracked ice holo": "reverse:cracked-ice",
  "poké ball foil": "reverse:pokeball",
  "poke ball foil": "reverse:pokeball",
  "master ball foil": "reverse:masterball",
  // Rarities that carry their own collector number.
  "illustration rare": "holo",
  "special illustration rare": "holo",
  "shiny rare": "holo",
  "shiny holo": "holo",
  "shiny full art": "holo",
  "full art": "holo",
  "secret rare": "holo",
  "rainbow rare": "holo",
  "ultra rare": "holo",
  "hyper rare": "holo",
  "mega hyper rare": "holo",
  "galarian gallery": "holo",
  "trainer gallery": "holo",
  // Stamps and distributions, which ride on a card that has no other number.
  //
  // `auto:` means the base printing is whatever the CARD is — a stamp does not
  // change a card's finish, it is applied on top of it. Writing the base by
  // hand gets it wrong in both directions: the Expansion Stamp sits on a plain
  // Lucario in Platinum and on a holo-only Lucario ex in Prismatic Evolutions,
  // and the same stamp name has to mean `normal:` in one and `holo:` in the
  // other. The catalog's rarity is what settles it.
  "gold snowflake stamp": "auto:gold-snowflake",
  "2009 comic-con stamp": "auto:comic-con-2009",
  "2009 comic-con staff stamp": "auto:comic-con-2009-staff",
  "pokémon center stamp": "auto:pokemon-center",
  "burger king": "auto:burger-king",
  "expansion stamp": "auto:expansion-stamp",
  "expansion staff stamp": "auto:expansion-staff-stamp",
  staff: "auto:staff",
  jumbo: "auto:jumbo",
  "play! pokémon": "auto:play-pokemon",
  "play! pokémon holo": "auto:play-pokemon",
  "league 1st place": "auto:league-1st",
  "league 2nd place": "auto:league-2nd",
  "league 3rd place": "auto:league-3rd",
  "league 4th place": "auto:league-4th",
};

/**
 * Is this card holo in the first place?
 *
 * Every rarity above the commons is foiled in some way, and the modern ones
 * (ex, GX, V, VSTAR, Double Rare, Illustration Rare) have no non-holo printing
 * at all. Commons, uncommons and plain "Rare" do.
 */
const isHolo = (rarity = "") => !/^(common|uncommon|rare)$/i.test(rarity.trim());

const lines = readFileSync(listPath, "utf8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean)
  // A bare Pokémon name on its own line is a section heading, not a card.
  .filter((l) => /—/.test(l));

/** "Riolu — Platinum 91/127 — Normal" -> its three parts. */
function parseLine(line) {
  const parts = line.split(/\s*—\s*/).filter(Boolean);
  if (parts.length !== 3) return null;
  const [name, setAndNumber, printing] = parts;

  const slash = setAndNumber.match(/^(.*?)\s+(\S+)\/(\S+)$/);
  const spaced = setAndNumber.match(/^(.*?)\s+([A-Z]{2,4})\s+(\d+[a-z]?)$/);
  const bare = setAndNumber.match(/^(.*?)\s+((?:BW|XY|SM|SWSH|DP|HGSS|SVP|MEP)\s?\d+[a-z]?)$/i);

  let setName;
  let number;
  if (slash) {
    [, setName, number] = slash;
  } else if (spaced) {
    setName = spaced[1];
    number = spaced[3]; // "SVP 017" -> the catalog numbers these bare
  } else if (bare) {
    setName = bare[1];
    number = bare[2].replace(/\s+/g, "");
  } else {
    return null;
  }
  // Sub-sets are separate sets in the catalog, named by their number prefix.
  if (/^GG/.test(number)) setName += " GG";
  else if (/^TG/.test(number)) setName += " TG";
  return { name, setName, number, printing };
}

let sets;
async function setIdFor(setName) {
  sets ??= (await get(`${API}/sets?pageSize=${PAGE}&select=id,name,total`)).data ?? [];
  const wanted = norm(ALIASES[setName] ?? setName);
  return sets.find((s) => norm(s.name) === wanted)?.id ?? null;
}

const memo = new Map();
/**
 * Every card in a set, PAGINATED and cached to disk.
 *
 * 250 is the API's maximum page and several sets are bigger — SWSH Black Star
 * Promos alone has 304. A single page returns a truncated set silently, and a
 * truncated set does not look like an error: it looks exactly like "that card
 * does not exist", which is how SWSH291 came back missing when it is really
 * there.
 */
async function setCards(setId) {
  if (memo.has(setId)) return memo.get(setId);
  const file = `${cacheDir}/${setId}.json`;
  if (existsSync(file)) {
    const rows = JSON.parse(readFileSync(file, "utf8"));
    memo.set(setId, rows);
    return rows;
  }
  const rows = [];
  for (let page = 1; ; page++) {
    const json = await get(
      `${API}/cards?q=${encodeURIComponent(`set.id:${setId}`)}&page=${page}&pageSize=${PAGE}` +
        `&select=id,name,number,images,set,rarity`,
    );
    const batch = json.data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  if (rows.length === 0) throw new Error("empty set response");
  writeFileSync(file, JSON.stringify(rows));
  memo.set(setId, rows);
  return rows;
}

/** Numbers are strings and not always numeric: 101a, TG01, SV001, 55a. */
const numKey = (n) => String(n).toLowerCase().replace(/^0+/, "");

const slots = [];
const failed = [];

for (const raw of lines) {
  const miss = (why) => {
    failed.push({ line: raw, why });
    slots.push(null);
  };
  const parsed = parseLine(raw);
  if (!parsed) {
    miss("could not read the set and number");
    continue;
  }

  let finish = FINISHES[norm(parsed.printing)];
  if (!finish) {
    miss(`unknown printing "${parsed.printing}" — add it to FINISHES`);
    continue;
  }

  let setId;
  try {
    setId = await setIdFor(parsed.setName);
  } catch (err) {
    miss(`set lookup failed: ${err.message}`);
    continue;
  }
  if (!setId) {
    miss(`no catalog set called "${parsed.setName}"`);
    continue;
  }

  let cards;
  try {
    cards = await setCards(setId);
  } catch (err) {
    miss(`catalog request failed: ${err.message} (re-run; the cache keeps the rest)`);
    continue;
  }

  const card = cards.find((c) => numKey(c.number) === numKey(parsed.number));
  if (!card) {
    miss(`${setId} has no card numbered ${parsed.number}`);
    continue;
  }

  /**
   * The number must actually BE the Pokémon the line names.
   *
   * Numbering differs between sources and between a set and its reprints, so a
   * number that resolves is not a number that is right. This check is the only
   * reason two wrong set ids were caught rather than shipped.
   */
  const want = parsed.name.split(/\s+/)[0].toLowerCase();
  if (!card.name.toLowerCase().includes(want)) {
    miss(`${setId}-${parsed.number} is ${card.name}, not ${parsed.name}`);
    continue;
  }

  // A stamp takes the base printing of the card it is stamped on.
  if (finish.startsWith("auto:")) {
    finish = `${isHolo(card.rarity) ? "holo" : "normal"}:${finish.slice(5)}`;
  }

  slots.push({
    kind: "card",
    cardId: card.id,
    finish,
    // Denormalised so the page renders offline and before the catalog answers.
    name: card.name,
    imageSmall: card.images?.small,
    collectorNumber: card.number,
  });
}

writeFileSync(outPath, JSON.stringify(slots, null, 2));
const filled = slots.filter(Boolean);
console.log(`${basename(listPath)}: resolved ${filled.length} / ${lines.length}`);
console.log(`  distinct cards: ${new Set(filled.map((s) => s.cardId)).size}`);
const dupes = new Map();
for (const s of filled) dupes.set(`${s.cardId}|${s.finish}`, (dupes.get(`${s.cardId}|${s.finish}`) ?? 0) + 1);
for (const [k, n] of dupes) if (n > 1) console.log(`  DUPLICATE ${k} x${n}`);
for (const f of failed) console.log(`  MISS  ${f.line}\n        ${f.why}`);
