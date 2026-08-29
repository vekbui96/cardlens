import type { CollectFinish } from "../models/cards.ts";
import { canonicalGame, DEFAULT_GAME, type TradingCardGame } from "../models/games.ts";

/**
 * The collection as an OR-Set of (card, finish) rows.
 *
 * Why not a plain list of owned cards: two devices editing while offline must
 * converge without a server arbitrating, and "I deleted this" has to outrank a
 * stale "I own this" regardless of which order the two arrive in. A removal is
 * therefore a tombstone (`deletedAt`), never a missing row — a missing row is
 * indistinguishable from "never seen", which would let a deletion silently
 * resurrect on the next sync.
 *
 * The merge is order-independent and idempotent, so syncing twice, out of
 * order, or after a fortnight offline all reach the same state.
 */
export interface OwnedPrinting {
  cardId: string;
  setId: string;
  finish: CollectFinish;
  /**
   * Which game this row belongs to. **Omitted for Pokémon**, which is the
   * default and by far the common case: writing it on every row would add a
   * redundant field to tens of thousands of them, and localStorage running out
   * is a bug this app has already had. Absence is resolved by `canonicalGame`
   * on read, so old rows and new ones mean the same thing.
   */
  game?: TradingCardGame;
  /**
   * The card's printed collector number — `"4"`, `"101a"`, `"TG01"`, `"SWSH001"`.
   *
   * Stored, not derived. The card id is NOT a substitute: `zsv10pt5-80` carries
   * `number: "60"` and collides with that set's real card 60, and `cel25c` has
   * four different cards numbered `15`. Splitting a set into its base and
   * master tiers (`models/setCompletion.ts`) is a question about numbers, so a
   * number guessed from an id would report the wrong tier rather than none.
   *
   * **Optional, and absence is meaningful.** Every row written before this
   * field existed lacks it, and a set whose owned cards cannot all be
   * classified declines a base tier instead of reporting a wrong one. Rows are
   * filled in as their set's card list is loaded (`Repositories.backfillNumbers`)
   * and as cards are marked — never invented.
   */
  number?: string;
  /** When this printing was marked owned. */
  at: number;
  /** When it was un-marked. Present means "not owned", not "never owned". */
  deletedAt?: number;
  /**
   * Not part of this master set, by the collector's own decision.
   *
   * A set's printings come from TCGdex, which lists everything ever printed of
   * a card — including promos and box toppers somebody chasing the main set
   * will never buy. Without this they read as permanently missing, and the
   * completion figure is wrong forever.
   *
   * A third state, not a second boolean: owned, excluded and removed are
   * mutually exclusive, and all three ride the existing OR-Set merge so an
   * exclusion converges across devices exactly like a mark does. Written only
   * when true, so no existing row changes shape.
   */
  excluded?: true;
}

/** Tombstones older than this are dropped — see pruneTombstones. */
export const TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60_000;

/**
 * Bound on a stored collector number. The longest real ones are short
 * (`SWSH001`, `XY-P`, `TG01`), so this is generous by an order of magnitude and
 * exists only to stop a public endpoint storing an essay in the field.
 */
export const MAX_COLLECTOR_NUMBER_LENGTH = 20;

/**
 * Read an untrusted collector number, or `undefined`.
 *
 * Shared by the device's read path and the server's `parseRow` for the same
 * reason the merge rule is: two validators that drift disagree about what a row
 * is, and the field then survives one hop and vanishes at the other.
 *
 * Note what this does NOT do: it never rejects the row. A number that fails to
 * parse costs a declined base tier; a rejected row costs the card. Collector
 * numbers are not an allow-list either — sets keep inventing shapes (`TG01`,
 * `GG01`, `H1`, `88a`, `XY-P`) — so this validates length and trims, nothing more.
 */
export function parseCollectorNumber(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_COLLECTOR_NUMBER_LENGTH) return undefined;
  return trimmed;
}

/**
 * Every OPTIONAL field a stored row may carry, read from an untrusted object.
 *
 * The one whitelist, spread by both of the two parsers that exist: the device's
 * `toPrintings` (src/storage/repositories.ts) and the server's `parseRow`
 * (server/collectionStore.ts). Those parsers cannot be merged — one reads its
 * own localStorage and the other reads the public internet, so they disagree
 * about what is fatal — but the LIST of optional fields is the same question at
 * both ends, and keeping two copies of it is what has cost this repo two bugs:
 * a field named at one end only is written by the device, accepted by nothing,
 * and silently gone on the next sync.
 *
 * Adding a field here adds it to both ends at once. That is the point.
 *
 * Each field is written only when it is not the default, exactly as it was
 * stored. Two spellings of one value ("absent" and "false", "absent" and "") is
 * how a convergent store starts ping-ponging between devices that agree.
 */
export function optionalRowFields(
  value: Record<string, unknown>,
): Pick<OwnedPrinting, "game" | "number" | "excluded"> {
  const game = canonicalGame(value.game);
  const number = parseCollectorNumber(value.number);
  return {
    // An unrecognised game falls back to the default rather than being stored:
    // an arbitrary string would partition the OR-Set into keys no client will
    // ever look under.
    ...(game === DEFAULT_GAME ? {} : { game }),
    ...(number === undefined ? {} : { number }),
    // Only `true` is meaningful, and only `true` is stored. Anything else is
    // treated as absent rather than rejected: a client that sends `false` means
    // "not excluded", which is what omitting it already says.
    ...(value.excluded === true ? { excluded: true as const } : {}),
  };
}

/** The game a row belongs to, with absence meaning the default. */
export function rowGame(row: Pick<OwnedPrinting, "game">): TradingCardGame {
  return canonicalGame(row.game);
}

/**
 * The OR-Set key.
 *
 * Computed, never stored — which is what makes it safe to have grown a game
 * segment. A row saved before games existed resolves to the default and
 * produces the identical key it always did, so nothing already on a device or
 * on the server changes identity, and the merge cannot split one printing into
 * two rows the way writing raw finishes once did.
 */
export function printingKey(cardId: string, finish: CollectFinish, game?: TradingCardGame): string {
  return `${canonicalGame(game)}|${cardId}|${finish}`;
}

export function isLive(row: OwnedPrinting): boolean {
  return row.at > (row.deletedAt ?? 0);
}

/** The row's last write, whichever kind it was. Also the sync watermark. */
export function rowStamp(row: OwnedPrinting): number {
  return Math.max(row.at, row.deletedAt ?? 0);
}

const stamp = rowStamp;

/**
 * Pick the winner between two versions of the same (card, finish).
 *
 * Ties go to the tombstone: if a mark and an un-mark carry the same timestamp
 * the user's last intent is unknowable, and re-adding a card is a one-gesture
 * fix whereas silently resurrecting a deleted one is invisible.
 *
 * Then to the exclusion, for the same reason. Excluding a printing marked in
 * the same millisecond is not hypothetical — the two writes happen back to
 * back when you exclude something you already own, and without this rule the
 * winner depended on map order, so the exclusion silently did nothing.
 * Restrictive intents win ties; both are one tap to undo.
 *
 * Last, and only when the two rows are otherwise the same write, the one that
 * KNOWS its collector number wins. Numbers are backfilled onto existing rows
 * without touching `at` — deliberately, because bumping it would rewrite when
 * the card was collected and re-push the whole collection to say nothing new —
 * so the two sides of a sync routinely hold the same row at the same stamp with
 * and without a number. Without this rule the numberless copy wins whenever it
 * happens to be merged first, and a device's first push to a server holding the
 * old rows would silently strip every number it had just learned. Ordering is by
 * value, not by argument position, so the merge stays commutative.
 */
function pickWinner(a: OwnedPrinting, b: OwnedPrinting): OwnedPrinting {
  const sa = stamp(a);
  const sb = stamp(b);
  if (sa !== sb) return sa > sb ? a : b;
  if (isLive(a) !== isLive(b)) return isLive(a) ? b : a;
  if (Boolean(a.excluded) !== Boolean(b.excluded)) return a.excluded ? a : b;
  if (a.number !== b.number) {
    if (a.number === undefined) return b;
    if (b.number === undefined) return a;
    return a.number < b.number ? a : b;
  }
  return a;
}

/**
 * Merge row sets into one convergent set. Pure and commutative: callers can
 * merge local-into-remote or remote-into-local and get the same answer.
 */
export function mergePrintings(...sets: OwnedPrinting[][]): OwnedPrinting[] {
  const winners = new Map<string, OwnedPrinting>();
  for (const rows of sets) {
    for (const row of rows) {
      const key = printingKey(row.cardId, row.finish, row.game);
      const existing = winners.get(key);
      winners.set(key, existing ? pickWinner(existing, row) : row);
    }
  }
  return [...winners.values()];
}

/**
 * Drop tombstones that are old enough that every device has certainly seen
 * them. Keeping them forever would grow the payload without bound; dropping
 * them too early would let a long-offline device resurrect a deleted card.
 */
export function pruneTombstones(rows: OwnedPrinting[], now = Date.now()): OwnedPrinting[] {
  return rows.filter((r) => isLive(r) || now - (r.deletedAt ?? 0) < TOMBSTONE_TTL_MS);
}

/**
 * Rows the user currently owns: tombstones and excluded printings both out.
 *
 * This is the single place ownership is derived, which is why excluding is
 * filtered HERE rather than at each call site — every count in the app (set
 * progress, collection value, showcase payload) reads through this function
 * and so cannot disagree about whether an excluded printing is held.
 */
export function livePrintings(rows: OwnedPrinting[]): OwnedPrinting[] {
  return rows.filter((r) => isLive(r) && !r.excluded);
}

/**
 * Printings deliberately left out of the master set.
 *
 * Live rows, like owned ones — an exclusion is a positive statement, not an
 * absence — so it survives a merge against a stale device that still thinks
 * the printing is merely unowned.
 */
export function excludedPrintings(rows: OwnedPrinting[]): OwnedPrinting[] {
  return rows.filter((r) => isLive(r) && r.excluded === true);
}

/**
 * Rows belonging to one game.
 *
 * Every count the UI shows — cards per set, printings held, what the
 * collection is worth — is a question about one game at a time. Mixing them
 * would not error, it would just quietly answer a question nobody asked.
 */
export function gamePrintings(rows: OwnedPrinting[], game: TradingCardGame = DEFAULT_GAME) {
  return rows.filter((r) => rowGame(r) === game);
}
