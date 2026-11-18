import { conditionLabel, slotQuantity, type Binder, type BinderSlot } from "./binderLayout.ts";
import { lineTotal } from "./binderValue.ts";
import { finishLabel } from "./finishes.ts";
import { formatUsd } from "../utils/format.ts";

/**
 * A binder as plain text, for pasting into a trade chat or a forum post.
 *
 * Pure, like `binderValue.ts`. It reads the binder and writes nothing. The same
 * rule as every total here: **an absent price is not zero**, so an unpriced
 * card says "unpriced" and the footer counts the priced ones separately.
 *
 * Names come from the slot (`name`, `collectorNumber`), which is stored with it.
 * A slot with no name is written as its card id rather than invented. Photos
 * and dividers (image slots) are not cards: they are left out of the list and
 * mentioned once at the end.
 */
export interface BinderText {
  text: string;
  /** Card pockets listed. */
  pockets: number;
}

function line(slot: BinderSlot, unit: number | undefined, showPrices: boolean): string | null {
  if (slot.kind !== "card") return null;
  const qty = slotQuantity(slot);
  const parts = [`${qty > 1 ? `${qty}x ` : ""}${slot.name?.trim() || slot.cardId}`];
  if (slot.collectorNumber) parts.push(`#${slot.collectorNumber}`);
  parts.push(finishLabel(slot.finish));
  if (slot.condition) parts.push(conditionLabel(slot.condition));
  if (showPrices) {
    const total = lineTotal(slot, unit);
    parts.push(total === undefined ? "unpriced" : formatUsd(total));
  }
  return parts.join(" - ");
}

export function binderToText(
  binder: Binder,
  priceFor: (slot: BinderSlot) => number | undefined,
  showPrices: boolean,
): BinderText {
  const slots = binder.pages.flatMap((page) =>
    Object.keys(page.slots)
      .map(Number)
      .sort((a, b) => a - b)
      .map((i) => page.slots[i]),
  );
  const lines: string[] = [];
  let copies = 0;
  let priced = 0;
  let total = 0;
  let images = 0;

  for (const slot of slots) {
    if (slot.kind !== "card") {
      images += 1;
      continue;
    }
    const unit = priceFor(slot);
    const text = line(slot, unit, showPrices);
    if (text === null) continue;
    lines.push(text);
    copies += slotQuantity(slot);
    const worth = lineTotal(slot, unit);
    if (worth !== undefined) {
      priced += 1;
      total += worth;
    }
  }

  const footer = [`${copies} card${copies === 1 ? "" : "s"}`];
  if (showPrices) {
    footer.push(`${priced} priced`);
    if (priced > 0) footer.push(`about ${total.toFixed(2)} USD`);
  }
  const out = [binder.name, "", ...lines, "", footer.join(", ")];
  if (images > 0) out.push(`(${images} photo or divider pocket${images === 1 ? "" : "s"} not listed)`);
  return { text: out.join("\n"), pockets: lines.length };
}
