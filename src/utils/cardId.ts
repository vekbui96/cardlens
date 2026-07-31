/**
 * pokemontcg.io card ids are `<setId>-<collectorNumber>` (e.g. `base1-4`,
 * `swsh45sv-SV001`). Set ids never contain a dash, so the last dash is the
 * boundary — which lets any screen holding only a card recover its set without
 * an extra fetch.
 */
export function setIdFromCardId(cardId: string): string {
  const cut = cardId.lastIndexOf("-");
  return cut > 0 ? cardId.slice(0, cut) : cardId;
}
