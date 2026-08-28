import { parseBinder } from "./binderParse.ts";
import { slotQuantity, type Binder, type CardSlot } from "./binderLayout.ts";

/**
 * A binder somebody is offering to trade from, as it arrives over a link.
 *
 * The payload is validated with the SAME parser the server validates a push
 * with (models/binderParse.ts). Not because the server is untrusted — it wrote
 * this — but because a shape the two ends disagree about is exactly the class
 * of bug that makes a pocket vanish at one of them, and there is no reason to
 * have a second opinion about what a binder is.
 */

export interface TradeShare {
  binder: Binder;
  /** Server clock at the moment it answered, for the "updated" line. */
  at: number;
}

export function parseTradeShare(value: unknown): TradeShare | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.kind !== "binder") return null;

  const binder = parseBinder(v.binder);
  if (!binder) return null;

  return { binder, at: typeof v.at === "number" ? v.at : Date.now() };
}

/** One card in the trade list, with where it is and how many there are. */
export interface TradeRow {
  slot: CardSlot;
  /** 1-based, as a collector counts them. */
  page: number;
  pocket: number;
  copies: number;
}

/**
 * Every card in the binder, flattened into a list that can be sorted.
 *
 * Images are dropped: a divider or a photo is part of how the binder reads,
 * not part of what is on offer, and a trade list that included them would
 * count them in "24 cards".
 *
 * Page and pocket travel with the row rather than being recomputed, because
 * the address is the whole point of the list — it is how the recipient names
 * the card when they ask for it.
 */
export function tradeRows(binder: Binder): TradeRow[] {
  const rows: TradeRow[] = [];
  binder.pages.forEach((page, pageIndex) => {
    for (const [key, slot] of Object.entries(page.slots)) {
      if (slot.kind !== "card") continue;
      rows.push({
        slot,
        page: pageIndex + 1,
        pocket: Number(key) + 1,
        copies: slotQuantity(slot),
      });
    }
  });
  // Pocket order within a page, so the list and the binder read the same way
  // before the viewer sorts it by anything else.
  return rows.sort((a, b) => a.page - b.page || a.pocket - b.pocket);
}
