import type { ScreenName } from "./navigation.ts";

const APP = "CardLens";

/**
 * Plain label per screen. A Record over `ScreenName` so a screen added to the
 * router without a label here fails to compile. Labels only: never a card, set
 * or binder name, nor a query.
 */
const LABELS: Record<ScreenName, string> = {
  home: "Home",
  results: "Search",
  details: "Card",
  favorites: "Favorites",
  recent: "Recent",
  popular: "Popular",
  sets: "Sets",
  set: "Set",
  collection: "My cards",
  owned: "Owned",
  sealed: "Sealed",
  target: "Target",
  scan: "Scan",
  showcase: "Showcase",
  live: "Live",
  binders: "Binders",
  binder: "Binder",
  // A shared binder is a showcase to the visitor, trade binder or not.
  trade: "Showcase",
  wantlist: "Want list",
  workshop: "Workshop",
};

/** `Search · CardLens`; plain `CardLens` for anything unmapped. */
export function screenTitle(name: ScreenName): string {
  const label = LABELS[name];
  return label ? `${label} · ${APP}` : APP;
}
