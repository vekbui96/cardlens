/**
 * The upstream query for `GET /api/catalog/cards`, built from a whitelist.
 *
 * `page` and `orderBy` were once dropped here, so a client paging past the
 * API's 250-card maximum got page 1 back for every page it asked for —
 * measured live, Paldea Evolved `page=2` answered `page 1, count 250 of 279`.
 * `page` is held to 1..10: the client's own guard, and no real set is near
 * 2,500 cards.
 */
export const MAX_CATALOG_PAGE = 10;

export function catalogCardsParams(query: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of ["q", "pageSize", "select", "orderBy"]) {
    const value = query[key];
    if (typeof value === "string" && value) params.set(key, value);
  }
  const page = query.page;
  if (typeof page === "string" && /^\d+$/.test(page)) {
    const n = Number(page);
    if (n >= 1 && n <= MAX_CATALOG_PAGE) params.set("page", String(n));
  }
  return params;
}
