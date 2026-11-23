/** Money + time formatting. Absent prices become "Unavailable" (never "$0.00"). */

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export const UNAVAILABLE = "Unavailable";

export function formatUsd(value: number | undefined | null): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return UNAVAILABLE;
  return usd.format(value);
}

/* --- The one way a card price and a movement percent are written ---------- */

/** The one word for a card with no price. */
export const UNPRICED = "Unpriced";

/** A card's price: "$412.50", or "Unpriced" when there is none — never "$0.00". */
export function formatPrice(value: number | undefined | null): string {
  const text = formatUsd(value);
  return text === UNAVAILABLE ? UNPRICED : text;
}

const oneDecimal = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * A movement percent: "+3.2%" / "−1.8%" / "0.0%". A real minus sign, not a
 * hyphen; no sign on a change that rounds to zero; halves round away from zero
 * on both sides, so the movers floor (±0.05) is symmetric. Only how the number
 * is written: what is computed stays in models/movement.ts.
 */
export function formatChange(pct: number): string {
  if (!Number.isFinite(pct)) return "—";
  const tenths = Math.round(Math.abs(pct) * 10);
  if (tenths === 0) return "0.0%";
  return `${pct > 0 ? "+" : "−"}${oneDecimal.format(tenths / 10)}%`;
}

/** The two movement windows the screens offer. */
export type ChangeWindow = 7 | 30;

const WINDOW_WORDS: Record<ChangeWindow, string> = { 7: "over 7 days", 30: "over 30 days" };

/** "over 7 days" / "over 30 days": a movement window in words, for a panel line. */
export function formatWindow(days: ChangeWindow): string {
  return WINDOW_WORDS[days];
}

/** "+3.2% over 7 days": a panel's movement line. */
export function formatChangeOver(pct: number, days: ChangeWindow): string {
  return `${formatChange(pct)} ${formatWindow(days)}`;
}

/** "+3.2% 7d": the compact form, for a row with no room for words. */
export function formatChangeShort(pct: number, days: ChangeWindow): string {
  return `${formatChange(pct)} ${days}d`;
}

/** Human "updated" label from an ISO timestamp; "" -> "Unknown". */
export function formatUpdated(iso: string, now: number = Date.now()): string {
  if (!iso) return "Unknown";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "Unknown";
  const diffMs = now - t;
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(t).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/** "223/197" style label if a set total is known, else just the number. */
export function formatCollector(collectorNumber: string, setTotal?: string): string {
  if (!collectorNumber) return "";
  return setTotal ? `${collectorNumber}/${setTotal}` : collectorNumber;
}
