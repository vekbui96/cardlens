/**
 * The Trade builder's totals and balance, as plain data.
 *
 * Every price here is USD (the catalog market price and the owned rows both
 * are); EUR is never mixed in. A card with no price is left out of its side's
 * total and counted in `unpriced`, never counted as zero.
 */
export interface PricedLine {
  price: number | undefined;
  qty: number;
}

export interface SideTotal {
  total: number;
  cards: number;
  unpriced: number;
}

export function sideTotal(lines: readonly PricedLine[]): SideTotal {
  let total = 0;
  let cards = 0;
  let unpriced = 0;
  for (const l of lines) {
    cards += l.qty;
    if (typeof l.price === "number" && l.price > 0) total += l.price * l.qty;
    else unpriced += l.qty;
  }
  return { total, cards, unpriced };
}

export interface Balance {
  /** Which side is worth more to you: "get" means you receive more than you give. */
  lean: "give" | "get" | "even";
  /** The gap in USD, always >= 0. */
  diff: number;
  /** The gap as a percent of the larger side, 0 to 100. */
  percent: number;
}

const cents = (n: number): number => Math.round(n * 100) / 100;

export function balance(giveTotal: number, getTotal: number): Balance {
  const give = cents(giveTotal);
  const get = cents(getTotal);
  const diff = cents(Math.abs(get - give));
  if (diff === 0) return { lean: "even", diff: 0, percent: 0 };
  const larger = Math.max(give, get);
  return { lean: get > give ? "get" : "give", diff, percent: (diff / larger) * 100 };
}
