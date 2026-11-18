import type { BinderSlot } from "./binderLayout.ts";
import { lineTotal } from "./binderValue.ts";
import { formatUsd } from "../utils/format.ts";

/**
 * What is left to chase in a binder, and roughly what it would cost.
 *
 * Planning a binder is mostly deciding where the cards you are still chasing
 * will go, so unowned cards are placeable and drawn shadowed. Nothing added
 * them up: the footnote counts cards and gives a total value, the chip counts
 * pockets filled, and "how many do I still need?" meant counting shadows by eye
 * across eleven pages.
 *
 * Pure, like `binderValue.ts`, because the sum is the part that can be wrong.
 * The screens hand in the two lookups they already hold: `owns` (per PRINTING —
 * a pocket holds a specific printing, so owning the card in another finish
 * still leaves it to get) and `priceFor` (one copy, USD).
 *
 * The same rule as the binder total: **an absent price is not zero.** Unpriced
 * cards are counted and never guessed, so `total` is the part we know.
 */
export interface StillToGet {
  /** Card pockets not owned. Image pockets never count. */
  cards: number;
  /** Summed line totals of the unowned pockets that carry a price. */
  total: number;
  /** How many of `cards` carry a price. */
  priced: number;
}

export function stillToGet(
  slots: readonly BinderSlot[],
  owns: (slot: BinderSlot) => boolean,
  priceFor: (slot: BinderSlot) => number | undefined,
): StillToGet {
  let cards = 0;
  let total = 0;
  let priced = 0;

  for (const slot of slots) {
    if (slot.kind !== "card" || owns(slot)) continue;
    cards += 1;
    const line = lineTotal(slot, priceFor(slot));
    if (line === undefined) continue;
    total += line;
    priced += 1;
  }

  return { cards, total, priced };
}

/**
 * The footnote line, worded once so the v1 web screen and v2 give one answer.
 *
 * While prices load it says so instead of a partial figure — the rule the
 * binder total already follows.
 */
export function stillToGetLine(summary: StillToGet, isLoading: boolean): string {
  if (summary.cards === 0) return "You own every card in this binder";
  const count = `Still to get: ${summary.cards} card${summary.cards === 1 ? "" : "s"}`;
  if (isLoading) return `${count} · pricing…`;
  if (summary.priced === 0) return `${count} (unpriced)`;
  const unpriced = summary.cards - summary.priced;
  if (unpriced === 0) return `${count} · ${formatUsd(summary.total)}`;
  return `${count} · ${formatUsd(summary.total)} for ${summary.priced} of them (${unpriced} unpriced)`;
}
