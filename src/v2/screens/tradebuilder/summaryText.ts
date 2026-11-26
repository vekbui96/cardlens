import { balance, sideTotal } from "./balanceModel.ts";

/** One card on a side of the trade, as the screen holds it. */
export interface TradeLine {
  name: string;
  setName: string;
  collectorNumber: string;
  qty: number;
  /** USD market price; absent or 0 means unpriced. */
  price: number | undefined;
}

const usd = (n: number): string => `$${n.toFixed(2)}`;
const hasPrice = (l: TradeLine): boolean => typeof l.price === "number" && l.price > 0;

function sideBlock(title: string, lines: readonly TradeLine[]): string[] {
  const t = sideTotal(lines);
  const out = [`${title}:`];
  for (const l of lines) {
    const price = hasPrice(l) ? usd((l.price as number) * l.qty) : "unpriced";
    out.push(`${l.qty} x ${l.name} (${l.setName} ${l.collectorNumber}) - ${price}`);
  }
  let total = `Total: ${t.total > 0 ? usd(t.total) : "no price yet"}`;
  if (t.unpriced > 0) total += ` (${t.unpriced} unpriced, not counted)`;
  out.push(total);
  return out;
}

/** The balance sentence, in USD. */
export function balanceLine(give: readonly TradeLine[], get: readonly TradeLine[]): string {
  const g = sideTotal(give);
  const r = sideTotal(get);
  if (g.total === 0 && r.total === 0) return "Balance: no prices yet, nothing to compare.";
  const b = balance(g.total, r.total);
  if (b.lean === "even") return "Balance: even, both sides are worth the same.";
  return `Balance: you ${b.lean === "get" ? "get" : "give"} ${usd(b.diff)} more.`;
}

/** The lines of the trade summary, shared by the text and the image. */
export function summaryLines(give: readonly TradeLine[], get: readonly TradeLine[]): string[] {
  return [
    ...sideBlock("I give", give),
    "",
    ...sideBlock("I get", get),
    "",
    balanceLine(give, get),
    "Prices are in USD.",
  ];
}

export function summaryText(give: readonly TradeLine[], get: readonly TradeLine[]): string {
  return summaryLines(give, get).join("\n");
}
