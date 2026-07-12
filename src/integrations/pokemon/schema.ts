import { z } from "zod";

/**
 * Zod schemas for pokemontcg.io v2 responses. Deliberately lenient: unknown
 * fields are ignored, price points may be null, and finish keys are dynamic.
 * We validate what we consume and surface a typed error otherwise.
 */

const nullableNumber = z.number().nullable().optional();

export const PricePointSchema = z
  .object({
    low: nullableNumber,
    mid: nullableNumber,
    high: nullableNumber,
    market: nullableNumber,
    directLow: nullableNumber,
  })
  .partial();
export type RawPricePoint = z.infer<typeof PricePointSchema>;

export const TcgplayerSchema = z
  .object({
    url: z.string().optional(),
    updatedAt: z.string().optional(),
    // Finish keys are dynamic (normal, holofoil, reverseHolofoil, 1stEdition…).
    prices: z.record(z.string(), PricePointSchema.nullable()).optional(),
  })
  .optional();

export const CardMarketSchema = z
  .object({
    url: z.string().optional(),
    updatedAt: z.string().optional(),
    prices: z.record(z.string(), z.unknown()).optional(),
  })
  .optional();

export const SetSchema = z.object({
  id: z.string(),
  name: z.string(),
  series: z.string().optional(),
  releaseDate: z.string().optional(),
  ptcgoCode: z.string().optional(),
});

export const CardSchema = z.object({
  id: z.string(),
  name: z.string(),
  supertype: z.string().optional(),
  subtypes: z.array(z.string()).optional(),
  number: z.string().optional(),
  artist: z.string().optional(),
  rarity: z.string().optional(),
  nationalPokedexNumbers: z.array(z.number()).optional(),
  set: SetSchema,
  images: z
    .object({
      small: z.string().optional(),
      large: z.string().optional(),
    })
    .optional(),
  tcgplayer: TcgplayerSchema,
  cardmarket: CardMarketSchema,
});
export type RawCard = z.infer<typeof CardSchema>;

export const CardListResponseSchema = z.object({
  data: z.array(CardSchema),
  page: z.number().optional(),
  pageSize: z.number().optional(),
  count: z.number().optional(),
  totalCount: z.number().optional(),
});

export const CardResponseSchema = z.object({
  data: CardSchema,
});
