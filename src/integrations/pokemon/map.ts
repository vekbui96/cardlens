import type {
  PokemonCardDetails,
  PokemonCardSummary,
  CardVariants,
  PokemonSet,
  PriceFinishKey,
} from "../../models/cards.ts";
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
    // Parsed by the schema but previously dropped here, so the set list had no
    // way to show the code collectors actually use.
    ...(raw.ptcgoCode ? { code: raw.ptcgoCode } : {}),
    ...(raw.series ? { series: raw.series } : {}),
    ...(raw.releaseDate ? { releaseDate: raw.releaseDate } : {}),
    ...(typeof raw.total === "number" ? { total: raw.total } : {}),
    ...(raw.images?.symbol ? { symbolImage: raw.images.symbol } : {}),
    ...(raw.images?.logo ? { logoImage: raw.images.logo } : {}),
  };
}

/**
 * Market price per finish, carried on the summary so the collection can price a
 * printing TCGdex has no number for without a per-card details fetch.
 *
 * The normaliser has already dropped zeros and NaNs; only the market point is
 * kept, because low/mid/high are a details-screen concern and the collection
 * only ever sums one figure per printing.
 */
function variantPricesFrom(raw: RawCard): Partial<Record<PriceFinishKey, number>> {
  const out: Partial<Record<PriceFinishKey, number>> = {};
  for (const [key, point] of Object.entries(normalizeTcgplayerPricing(raw.tcgplayer).variants)) {
    const market = point?.market;
    if (typeof market === "number" && market > 0) out[key as PriceFinishKey] = market;
  }
  return out;
}

export function toSummary(raw: RawCard): PokemonCardSummary {
  const market = normalizeTcgplayerPricing(raw.tcgplayer).marketPrice;
  const variants = variantsFromPrices(raw);
  const hasVariants = Object.values(variants).some(Boolean);
  const variantPrices = variantPricesFrom(raw);
  const hasPrices = Object.keys(variantPrices).length > 0;
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
    ...(hasPrices ? { variantPrices } : {}),
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
