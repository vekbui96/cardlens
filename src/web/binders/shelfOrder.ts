/**
 * "Edited 3d ago" for a binder tile.
 *
 * `updatedAt` moves on any change from any device (a sync, a page reorder), so
 * this is "last changed", which is the honest reading. Display only: nothing is
 * stored differently. A missing or non-finite stamp yields no line at all.
 */
export function formatEdited(updatedAt: number, now: number = Date.now()): string {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return "";
  const min = Math.floor((now - updatedAt) / 60000);
  if (min < 1) return "Edited just now";
  if (min < 60) return `Edited ${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `Edited ${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `Edited ${day}d ago`;
  return `Edited ${new Date(updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}
