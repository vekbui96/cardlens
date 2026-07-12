import type { CardPriceResult, PriceFinishKey, VariantPrice } from "../../models/cards.ts";
import type { RawPricePoint } from "../pokemon/schema.ts";

const SOURCE_LABEL = "TCGplayer (via pokemontcg.io)";

/** Map pokemontcg.io finish keys onto our normalized variant keys. */
const FINISH_MAP: Record<string, PriceFinishKey> = {
  normal: "normal",
  unlimited: "normal",
  holofoil: "holofoil",
  unlimitedHolofoil: "holofoil",
  reverseHolofoil: "reverseHolofoil",
  "1stEdition": "firstEditionNormal",
  "1stEditionNormal": "firstEditionNormal",
  "1stEditionHolofoil": "firstEditionHolofoil",
};

/** Deterministic headline preference — the "primary" finish shown up top. */
const HEADLINE_ORDER: PriceFinishKey[] = [
  "holofoil",
  "normal",
  "reverseHolofoil",
  "firstEditionHolofoil",
  "firstEditionNormal",
];

/** Treat 0 / null / NaN / non-finite as ABSENT so the UI shows "Unavailable". */
export function cleanPrice(value: number | null | undefined): number | undefined {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

function toVariantPrice(raw: RawPricePoint | null | undefined): VariantPrice | undefined {
  if (!raw) return undefined;
  const variant: VariantPrice = {
    market: cleanPrice(raw.market),
    low: cleanPrice(raw.low),
    mid: cleanPrice(raw.mid),
    high: cleanPrice(raw.high),
  };
  const hasAny = Object.values(variant).some((v) => v !== undefined);
  return hasAny ? variant : undefined;
}

/** Convert "YYYY/MM/DD" (or ISO) to ISO 8601; "" when unknown. */
export function toIso(updatedAt?: string): string {
  if (!updatedAt) return "";
  const m = updatedAt.match(/^(\d{4})[/-](\d{2})[/-](\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`;
  const parsed = new Date(updatedAt);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

export interface RawTcgplayer {
  url?: string;
  updatedAt?: string;
  prices?: Record<string, RawPricePoint | null> | undefined;
}

/**
 * Normalize a card's raw TCGplayer pricing into our CardPriceResult. Never mixes
 * finishes; labels the source; picks a deterministic headline finish; empties are
 * left undefined (rendered "Unavailable", never "$0.00").
 */
export function normalizeTcgplayerPricing(tcgplayer: RawTcgplayer | undefined): CardPriceResult {
  const result: CardPriceResult = {
    currency: "USD",
    source: SOURCE_LABEL,
    lastUpdated: toIso(tcgplayer?.updatedAt),
    variants: {},
  };

  const prices = tcgplayer?.prices ?? {};
  for (const [rawKey, rawValue] of Object.entries(prices)) {
    const mapped = FINISH_MAP[rawKey];
    if (!mapped) continue;
    const variant = toVariantPrice(rawValue);
    if (variant) result.variants[mapped] = variant;
  }

  const headline = HEADLINE_ORDER.find((k) => result.variants[k]);
  if (headline) {
    const v = result.variants[headline];
    result.headlineFinish = headline;
    result.marketPrice = v?.market;
    result.lowPrice = v?.low;
    result.midPrice = v?.mid;
    result.highPrice = v?.high;
  }

  return result;
}
