/**
 * Chase-card rarity filters. `rarities` are the exact pokemontcg.io rarity strings
 * a filter matches (OR-ed together); `null` means no filter. "Full Art" and
 * "Hyper" span a couple of era-specific rarity names so both SV and SWSH cards
 * are covered.
 */
export interface RarityFilter {
  key: string;
  /** Long label for the header. */
  label: string;
  /** Short chip label. */
  short: string;
  rarities: string[] | null;
}

export const RARITY_FILTERS: RarityFilter[] = [
  { key: "all", label: "All rarities", short: "All", rarities: null },
  { key: "ir", label: "Illustration Rare", short: "IR", rarities: ["Illustration Rare"] },
  { key: "sir", label: "Special Illustration Rare", short: "SIR", rarities: ["Special Illustration Rare"] },
  { key: "fullart", label: "Full Art / Ultra", short: "Full Art", rarities: ["Ultra Rare", "Rare Ultra"] },
  {
    key: "hyper",
    label: "Hyper / Rainbow",
    short: "Hyper",
    rarities: ["Hyper Rare", "Rare Rainbow", "Rare Secret"],
  },
];

export function rarityFilterAt(index: number): RarityFilter {
  const len = RARITY_FILTERS.length;
  return RARITY_FILTERS[((index % len) + len) % len];
}
