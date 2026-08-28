import { conditionLabel, slotQuantity, type BinderSlot } from "./binderLayout.ts";

/**
 * How a pocket's contents are written down.
 *
 * Split out of components/BinderPage.tsx because these are pure string
 * functions over the model, not components — the lint rule that objects to
 * mixing them is right, and the trade screen wants the address formatter
 * without importing a React component to get it.
 */

/**
 * Where a card is, said the way two collectors say it: page, then pocket.
 *
 * Both 1-based, because that is how a binder is counted by the person holding
 * it — there is no pocket zero. The separator is a middle dot rather than a
 * slash or a colon: "2/5" reads as a collector number in this hobby, and this
 * is emphatically not one.
 */
export function pocketAddress(pageNumber: number, index: number): string {
  return `${pageNumber}\u00b7${index + 1}`;
}

/**
 * What is behind a pocket, beyond the one card you can see.
 *
 * Empty when there is nothing to add — a single ungraded copy is the default
 * and printing "×1" on every pocket of an untraded binder would be noise on
 * every thumbnail to say nothing.
 */
export function stockLabel(slot: BinderSlot): string {
  if (slot.kind !== "card") return "";
  const copies = slotQuantity(slot);
  return [copies > 1 ? `\u00d7${copies}` : "", slot.condition ?? ""].filter(Boolean).join(" ");
}

/** The same facts as words, for the accessible name. "x3 LP" is not readable aloud. */
export function spokenStock(slot: BinderSlot): string {
  if (slot.kind !== "card") return "";
  const copies = slotQuantity(slot);
  return [
    copies > 1 ? `, ${copies} copies` : "",
    slot.condition ? `, ${conditionLabel(slot.condition)}` : "",
  ].join("");
}

/** Compact enough for a pocket: "$12.34", "$1.2k", or "n/a". */ export function formatBinderPrice(
  price: number | undefined,
): string {
  if (price === undefined || !Number.isFinite(price) || price <= 0) return "n/a";
  if (price >= 1000) return `$${(price / 1000).toFixed(price >= 10_000 ? 0 : 1)}k`;
  return `$${price.toFixed(price >= 100 ? 0 : 2)}`;
}
