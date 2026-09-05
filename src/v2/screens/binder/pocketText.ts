import {
  conditionLabel,
  slotQuantity,
  type BinderAddress,
  type BinderSlot,
} from "../../../models/binderLayout.ts";
import { formatBinderPrice, spokenStock } from "../../../models/binderPocket.ts";

/**
 * How a pocket is written down.
 *
 * Pure string functions, in a `.ts` rather than beside the component, for the
 * same reason `models/binderPocket.ts` exists in v1: mixing them into a `.tsx`
 * trips `react-refresh/only-export-components`, and the tests want the naming
 * rules without rendering anything to get them.
 *
 * These names are also the SELECTORS. Both test suites find a pocket by its
 * accessible name, which is on purpose — a pocket the tests can find is a
 * pocket a screen reader can find, so the naming is not a separate task done
 * afterwards.
 */

/** What is in a pocket, in words. A card's name, or an image's label. */
export function slotName(slot: BinderSlot): string {
  if (slot.kind === "image") return slot.label ?? "custom image";
  return slot.name ?? slot.cardId;
}

export interface PocketLabelParts {
  slot: BinderSlot | undefined;
  index: number;
  pageNumber: number;
  /** Whether the collection this binder is judged against holds it. */
  held: boolean;
  /**
   * Trade mode adds the page to the address, because a trade is negotiated by
   * saying "page 2, pocket 5" out loud, and the stock, because copies and
   * grade are what the other collector is deciding about.
   */
  trade?: boolean;
  price?: number | undefined;
  /** True when the screen shows prices at all. `undefined` price still says "n/a". */
  priced?: boolean;
}

/**
 * The accessible name for one pocket.
 *
 * Spelled out rather than abbreviated: a screen reader should say "3 copies,
 * lightly played", not "x3 LP", and "page 2, pocket 5", not "2 dot 5".
 */
export function pocketLabel({
  slot,
  index,
  pageNumber,
  held,
  trade = false,
  price,
  priced = false,
}: PocketLabelParts): string {
  const where = `${trade ? `Page ${pageNumber}, ` : ""}Pocket ${index + 1}`;
  if (!slot) return `${where}, empty`;

  const what = slot.kind === "image" ? slotName(slot) : `${slotName(slot)}, ${held ? "owned" : "not owned"}`;
  const stock = trade ? spokenStock(slot) : "";
  const money = priced ? `, ${formatBinderPrice(price)}` : "";
  return `${where}, ${what}${stock}${money}`;
}

/** The cover names itself, because it is not a pocket and has no number. */
export function coverLabel(slot: BinderSlot | null | undefined): string {
  return slot ? `Cover, ${slotName(slot)}` : "Cover, empty";
}

/** "Pocket 5 on page 2", for the line that says what is being filled. */
export function addressPhrase(at: BinderAddress): string {
  return at.kind === "cover" ? "the cover" : `pocket ${at.index + 1} on page ${at.page + 1}`;
}

/** What a pocket already holds, for the sheet that offers to change it. */
export function stockPhrase(slot: BinderSlot): string {
  if (slot.kind !== "card") return slotName(slot);
  const copies = slotQuantity(slot);
  return [
    slotName(slot),
    copies > 1 ? `${copies} copies` : "",
    slot.condition ? conditionLabel(slot.condition) : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
