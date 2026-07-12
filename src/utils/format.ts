/** Money + time formatting. Absent prices become "Unavailable" (never "$0.00"). */

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export const UNAVAILABLE = "Unavailable";

export function formatUsd(value: number | undefined | null): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return UNAVAILABLE;
  return usd.format(value);
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
