/**
 * Where a results list was scrolled to, per query.
 *
 * Back from a card has to land on the same row you left, not at the top. The
 * browser cannot do this for us: a hash navigation restores scroll before React
 * has re-rendered the grid, so the page is still one screen tall at the moment
 * the restore happens and the position is clamped to zero.
 *
 * Keyed by query rather than by history entry, because two entries for the same
 * search are the same list — going back through several cards from one set of
 * results should return to the same place each time.
 *
 * `sessionStorage` rather than a module-level Map so a reload keeps it, and
 * every access is guarded: Safari's private mode throws on write, and a search
 * screen is not worth taking down over a scroll offset.
 */

const PREFIX = "v2:search-scroll:";

export function rememberScroll(query: string, y: number): void {
  if (!query) return;
  try {
    sessionStorage.setItem(PREFIX + query, String(Math.round(y)));
  } catch {
    // Storage is full or blocked. The list still works; it just starts at the top.
  }
}

export function recallScroll(query: string): number {
  if (!query) return 0;
  try {
    const raw = sessionStorage.getItem(PREFIX + query);
    if (raw === null) return 0;
    const y = Number(raw);
    return Number.isFinite(y) && y > 0 ? y : 0;
  } catch {
    return 0;
  }
}
