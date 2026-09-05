import {
  canRemoveLastPage,
  moveSlot,
  nextEmptyPocket,
  putAt,
  specFor,
  type Binder,
  type BinderAddress,
  type BinderCounts,
  type BinderFormat,
  type BinderSlot,
  type CardSlot,
} from "../../../models/binderLayout.ts";
import { formatBinderPrice, spokenStock } from "../../../models/binderPocket.ts";
import { imageSlotSrc } from "../../../services/sync/binderImages.ts";
import { SyncAuthError, SyncDisabledError, SyncTooLargeError } from "../../../services/sync/http.ts";
import type { DragSource } from "../../../features/binders/useBinderDrag.ts";
import type { CollectFinish, PokemonCardSummary } from "../../../models/cards.ts";
import { finishLabel } from "../../../models/finishes.ts";

/**
 * What the binder builder decides, with no React around it.
 *
 * Every mutation this screen performs already exists in `models/binderLayout.ts`
 * — `putAt`, `moveSlot`, `addPage`, `reformat` and the rest are pure and tested
 * there, and nothing below reimplements one. What lives here is the layer above
 * that: which of those calls a gesture means, where the selection goes
 * afterwards, and how the result is written down for someone who cannot see the
 * screen. Those are the decisions with a plausible wrong answer, so they are
 * pulled out where they can be asserted without a browser.
 */

/* --- Words ---------------------------------------------------------------- */

/**
 * "1 card", never "1 cards".
 *
 * Trivial, and stated once on purpose: this screen counts five different things
 * — cards, copies, pockets, pages, printings — and the count is in the sentence
 * a screen reader reads out. A visual snapshot caught exactly this bug on a
 * sibling screen, which is a slow way to find it.
 */
export function plural(count: number, word: string, plural = `${word}s`): string {
  return `${count} ${count === 1 ? word : plural}`;
}

/** The art a slot resolves to, or nothing. Server-held images are by id. */
export function slotArt(slot: BinderSlot): string | undefined {
  return slot.kind === "card" ? slot.imageSmall : imageSlotSrc(slot);
}

/**
 * What to call what is in a pocket.
 *
 * A card slot carries a denormalised `name` so a page paints offline; binders
 * filled before that field existed have only the id, which is ugly but is still
 * the difference between "there is a card here" and silence.
 */
export function slotTitle(slot: BinderSlot): string {
  if (slot.kind === "image") return slot.label ?? "Custom image";
  return slot.name ?? slot.cardId;
}

export interface PocketLabelParts {
  slot: BinderSlot | undefined;
  /** 0-based, as stored. Spoken 1-based, because there is no pocket zero. */
  index: number;
  pageNumber: number;
  /** Whether the collection holds this printing. Only meaningful for a card. */
  held: boolean;
  /** A trade binder says the stock out loud; an ordinary one has none to say. */
  trade: boolean;
  price: number | undefined;
}

/**
 * The pocket's accessible name — which is also how the e2e finds it.
 *
 * Built rather than left to the contents, unlike `SetPocket`, because a pocket's
 * contents are one image and three badges: the art is decorative (a screen
 * reader read nine card names it cannot act on is worse than silence) and the
 * badges are glyphs and colours. Without a label the whole page reads as a row
 * of unnamed buttons.
 *
 * The address leads, and it leads on EVERY pocket including the empty ones,
 * because the thing being navigated here is positions. "Page 2, pocket 5, empty"
 * is the sentence that lets someone fill a binder without seeing it.
 */
export function pocketLabel({ slot, index, pageNumber, held, trade, price }: PocketLabelParts): string {
  const where = `Page ${pageNumber}, pocket ${index + 1}`;
  if (!slot) return `${where}, empty`;
  const what =
    slot.kind === "image" ? slotTitle(slot) : `${slotTitle(slot)}, ${held ? "owned" : "not owned"}`;
  // Words, not "×3 LP": the stock badge is an abbreviation and reads aloud as
  // nonsense. See spokenStock.
  const stock = trade ? spokenStock(slot) : "";
  const money = price === undefined ? ", price unavailable" : `, ${formatBinderPrice(price)}`;
  return `${where}, ${what}${stock}${money}`;
}

/**
 * The cover's name. It is a slot, but never a pocket — no index, and it never
 * says which page it is on, because it is not on one.
 */
export function coverLabel(binder: Binder): string {
  return binder.cover ? `Cover, ${slotTitle(binder.cover)}` : "Cover, empty";
}

/**
 * What this binder holds, under it.
 *
 * On a trade binder the figure that matters is COPIES — twelve pockets can hold
 * thirty cards, and thirty is what is being offered — so it leads, with the
 * pocket count behind it. On any other binder the two are equal by construction
 * and printing both would be noise.
 */
export function footnote(binder: Binder, counts: BinderCounts): string {
  const shape = `${plural(binder.pages.length, "page")} · ${specFor(binder.format).label}`;
  if (binder.forTrade) {
    return `${plural(counts.copies, "card")} in ${plural(counts.cards, "pocket")} across ${shape}`;
  }
  return `${plural(counts.cards, "card")} across ${shape}`;
}

export interface ValueLine {
  /** Pass to `Money`. True while no set has answered yet. */
  loading: boolean;
  total: number | undefined;
  /** "3 unpriced", or "" when everything in the binder carries a price. */
  note: string;
}

/**
 * The binder's total, honestly.
 *
 * The unpriced count rides with the number rather than being dropped. Whole
 * categories cannot be priced at all — stamps and promos ride on finishes the
 * oracle has never heard of — so a bare total reads as the whole answer when it
 * is only ever the part we know. `undefined` while loading rather than 0,
 * because `Money` must never print `$0.00` for a binder nobody has priced yet.
 */
export function valueLine(value: { isLoading: boolean; total: number; unpriced: number }): ValueLine {
  if (value.isLoading) return { loading: true, total: undefined, note: "" };
  return {
    loading: false,
    total: value.total,
    note: value.unpriced > 0 ? `${value.unpriced} unpriced` : "",
  };
}

/** What the screen is waiting for you to do. Shown above the pages. */
export function prompt(at: BinderAddress | null): string {
  if (!at) return "Choose a pocket to fill it, or drag a card from one pocket to another.";
  if (at.kind === "cover") return "Cover chosen — pick a card for the window on the front, or clear it.";
  return `Page ${at.page + 1}, pocket ${at.index + 1} chosen — pick a card, or clear it.`;
}

/** What is switched on, visible without opening the settings. */
export function settingTags(binder: Binder): string[] {
  const tags: string[] = [];
  if (binder.forTrade) tags.push("For trade");
  if (binder.showValue) tags.push("Priced in list");
  return tags;
}

/* --- Where the selection goes --------------------------------------------- */

/**
 * The pocket to be on after writing to `at`.
 *
 * Filling a binder is a SEQUENCE, and this is the decision that makes it one.
 * The pocket used to stay selected after a place, so every card picked after the
 * first replaced the one before it and the binder never grew past a single card
 * — with nothing on screen to say so, which reads exactly like a picker that
 * refuses to add anything.
 *
 * Three rules, and each has a case behind it:
 *
 *  - Placing advances to the next empty pocket, forward only. Never wrapping:
 *    a pocket left empty behind the cursor was skipped on purpose as often as
 *    by accident, and jumping backwards drops the next card out of sight.
 *  - Clearing stays put. Emptying a pocket is an edit to THAT pocket, and
 *    moving off it would take the selection away from what was just emptied.
 *  - The cover never advances. It is one slot, not the first of a run, and
 *    stepping off it into page 1 pocket 1 would be the app deciding you meant
 *    to carry on filling pages when you were setting a cover.
 */
export function afterPlace(binder: Binder, at: BinderAddress, slot: BinderSlot | null): BinderAddress | null {
  if (!slot) return at;
  if (at.kind === "cover") return at;
  return nextEmptyPocket(binder, at);
}

export interface DropResult {
  binder: Binder;
  /**
   * Where the selection should move, or null to leave it alone.
   *
   * Null for a pocket-to-pocket move on purpose. Rearranging a binder is not
   * filling one: dropping a card into pocket 5 and having the picker open on
   * pocket 5 answers a question nobody asked, and does it once per card while a
   * page is being tidied. A card dragged in from the PICKER is the other case —
   * that IS filling, and the panel it opens is where copies, condition and "I
   * own this" are set for the card just placed.
   */
  select: BinderAddress | null;
}

/**
 * A drag landed. Two different writes, and the difference is not cosmetic.
 *
 * Moving SWAPS, because the card leaving the source pocket has to go somewhere
 * and destroying it would have no undo — `moveSlot` also refuses a drop back
 * onto the pocket it came from, which is the commonest way a drag ends and used
 * to delete the card.
 *
 * A card from the PICKER replaces, because it came from the catalog and there is
 * nothing to swap back. That is the same rule `placeSlot` documents for putting
 * a card into an occupied sleeve: physically, there is no third state where two
 * cards share one pocket.
 */
export function dropWrite(
  binder: Binder,
  source: DragSource,
  slot: BinderSlot,
  to: BinderAddress,
  now: number,
): DropResult {
  if (source.kind === "new") return { binder: putAt(binder, to, slot, now), select: to };
  return { binder: moveSlot(binder, source.at, to, now), select: null };
}

/* --- Pages ---------------------------------------------------------------- */

export interface RemovePageState {
  disabled: boolean;
  /** Why not, for the button's title and its accessible name. "" when it is on. */
  reason: string;
}

/**
 * Whether the last page can go, and why not when it cannot.
 *
 * Two different refusals, and a disabled button that does not say which is a
 * button that looks broken. Nothing trims trailing empty pages automatically —
 * a blank page kept on purpose and a blank page left over look identical, and
 * the automatic trim is what made "Add page" a silent no-op for as long as
 * binders existed: it grew the binder and the same commit dropped the new page
 * again.
 */
export function removePageState(binder: Binder): RemovePageState {
  if (binder.pages.length <= 1) return { disabled: true, reason: "a binder keeps its first page" };
  if (!canRemoveLastPage(binder)) return { disabled: true, reason: "the last page still has cards in it" };
  return { disabled: false, reason: "" };
}

/**
 * The page's geometry, as custom properties.
 *
 * Columns and rows come from the format and nothing else, so a fourth format
 * would need no new number here or in the stylesheet. The pocket SIZE is not
 * here on purpose: it is a length, it belongs in `binder.module.css` where it
 * can be a `calc()` over the tokens, and it is keyed off `data-format` rather
 * than passed in.
 */
export function pageVars(format: BinderFormat): Record<string, string> {
  const spec = specFor(format);
  return { "--cols": String(spec.cols), "--rows": String(spec.rows) };
}

/* --- The picker ----------------------------------------------------------- */

/**
 * A pocket's worth of catalog card.
 *
 * Built in ONE place because the click and the drag place the identical slot,
 * and two copies of this object is how they come to disagree about a field —
 * which surfaces months later as a binder whose art loads on one device and not
 * on another. The denormalised name, art and number are what let a page paint
 * offline and before the catalog answers.
 */
export function newSlot(card: PokemonCardSummary, finish: CollectFinish): CardSlot {
  return {
    kind: "card",
    cardId: card.id,
    finish,
    name: card.name,
    imageSmall: card.imageSmall,
    collectorNumber: card.collectorNumber,
  };
}

/** How a printing is offered in the picker, and named for assistive technology. */
export function printingLabel(card: PokemonCardSummary, finish: CollectFinish, owned: boolean): string {
  return `${card.name}, ${card.collectorNumber}, ${finishLabel(finish)}, ${owned ? "owned" : "not owned"}`;
}

/**
 * Say what actually went wrong with an upload.
 *
 * A single "could not add image" would collapse four different situations —
 * a rejected token, sync switched off at the server, a file too big even after
 * resizing, and no connection — into one message that tells the user nothing
 * about which of them to fix. Three of the four are fixable by the person
 * reading it, and each is fixed somewhere different.
 */
export function imageErrorMessage(err: unknown): string {
  if (err instanceof SyncAuthError) return "The server rejected this device's sync token.";
  if (err instanceof SyncDisabledError) return "The server has sync switched off, so it cannot hold images.";
  if (err instanceof SyncTooLargeError) return "That image is too large, even after resizing.";
  if (err instanceof Error && err.message) return err.message;
  return "Could not reach the server to store that image.";
}
