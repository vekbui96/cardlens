import type { PokemonCardDetails, PokemonCardSummary, CardVariants, PokemonSet } from "../../models/cards.ts";
import type { RankableCard } from "../../services/search/rank.ts";
import { normalizeTcgplayerPricing } from "../pricing/normalize.ts";
import type { RawCard, RawSet } from "./schema.ts";

function variantsFromPrices(raw: RawCard): CardVariants {
  const keys = Object.keys(raw.tcgplayer?.prices ?? {});
  return {
    normal: keys.includes("normal") || keys.includes("unlimited"),
    holofoil: keys.includes("holofoil"),
    reverseHolofoil: keys.includes("reverseHolofoil"),
    firstEdition: keys.some((k) => k.startsWith("1stEdition")),
  };
}

export function toSet(raw: RawSet): PokemonSet {
  return {
    id: raw.id,
    name: raw.name,
    ...(raw.series ? { series: raw.series } : {}),
    ...(raw.releaseDate ? { releaseDate: raw.releaseDate } : {}),
    ...(typeof raw.total === "number" ? { total: raw.total } : {}),
    ...(raw.images?.symbol ? { symbolImage: raw.images.symbol } : {}),
    ...(raw.images?.logo ? { logoImage: raw.images.logo } : {}),
  };
}

export function toSummary(raw: RawCard): PokemonCardSummary {
  const market = normalizeTcgplayerPricing(raw.tcgplayer).marketPrice;
  const variants = variantsFromPrices(raw);
  const hasVariants = Object.values(variants).some(Boolean);
  return {
    id: raw.id,
    name: raw.name,
    setName: raw.set.name,
    setCode: raw.set.ptcgoCode ?? raw.set.id,
    collectorNumber: raw.number ?? "",
    ...(raw.rarity ? { rarity: raw.rarity } : {}),
    ...(raw.images?.small ? { imageSmall: raw.images.small } : {}),
    ...(raw.images?.large ? { imageLarge: raw.images.large } : {}),
    ...(typeof market === "number" ? { marketPrice: market } : {}),
    // Omitted entirely when the payload revealed no finishes, so consumers can
    // tell "no pricing data" apart from "exists only as normal".
    ...(hasVariants ? { variants } : {}),
  };
}

export function toRankable(raw: RawCard): RankableCard {
  return {
    ...toSummary(raw),
    ...(raw.set.releaseDate ? { releaseDate: raw.set.releaseDate } : {}),
    ...(raw.nationalPokedexNumbers ? { nationalPokedexNumbers: raw.nationalPokedexNumbers } : {}),
  };
}

export function toDetails(raw: RawCard): PokemonCardDetails {
  return {
    ...toSummary(raw),
    ...(raw.supertype ? { supertype: raw.supertype } : {}),
    ...(raw.subtypes ? { subtypes: raw.subtypes } : {}),
    ...(raw.artist ? { artist: raw.artist } : {}),
    ...(raw.set.releaseDate ? { releaseDate: raw.set.releaseDate } : {}),
    ...(raw.nationalPokedexNumbers ? { nationalPokedexNumbers: raw.nationalPokedexNumbers } : {}),
    variants: variantsFromPrices(raw),
  };
}
