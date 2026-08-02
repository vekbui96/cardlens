import { z } from "zod";

/**
 * Schemas for the TCGdex v2 API, used only as a printings oracle.
 *
 * pokemontcg.io stays the catalog (search, images, pricing headline) — this
 * exists because it cannot answer "which printings does this card have".
 * Surveyed live: it reports no variant keys at all for Pitch Black (me5), and
 * never reports pattern foils for any set.
 *
 * Lenient by design: TCGdex adds new foil names as sets invent them
 * (pokeball, masterball, tinsel, cosmos, energy, friendball, loveball,
 * quickball, team-rocket were all found in three 2025-26 sets), so `foil` is a
 * free string rather than an enum. Hardcoding it would be wrong by the next
 * release.
 */

export const TcgdexVariantSchema = z.object({
  /** normal | reverse | holo | firstEdition | ... */
  type: z.string(),
  /** Pattern name when the printing is a patterned foil; absent for plain ones. */
  foil: z.string().optional(),
  size: z.string().optional(),
  /**
   * `"generated"` when TCGdex has no real variant data and synthesised this
   * entry. Older sets are entirely generated — every card in Hidden Fates and
   * Team Up reports a single made-up `normal` — so the type carries no
   * information there and must not be treated as evidence. See toPrintings.
   */
  variantId: z.string().optional(),
});
export type TcgdexVariant = z.infer<typeof TcgdexVariantSchema>;

/**
 * Prices, keyed by TCGdex's own finish names.
 *
 * Deliberately `unknown` values: the map mixes price objects with `unit` and
 * `updated` strings, and TCGdex adds keys as sets invent printings. Narrowing
 * happens in the client, where an unrecognised key is skipped rather than
 * rejected — the same reason `foil` is a free string.
 */
export const TcgdexPricingSchema = z
  .object({
    tcgplayer: z.record(z.string(), z.unknown()).optional(),
    cardmarket: z.record(z.string(), z.unknown()).optional(),
  })
  .optional();

export const TcgdexCardSchema = z.object({
  id: z.string(),
  localId: z.union([z.string(), z.number()]).optional(),
  name: z.string().optional(),
  rarity: z.string().optional(),
  variants_detailed: z.array(TcgdexVariantSchema).optional(),
  pricing: TcgdexPricingSchema,
});
export type TcgdexCard = z.infer<typeof TcgdexCardSchema>;

export const TcgdexSetBriefSchema = z.object({
  id: z.string(),
  name: z.string(),
  cardCount: z
    .object({
      total: z.number().optional(),
      official: z.number().optional(),
    })
    .optional(),
});
export type TcgdexSetBrief = z.infer<typeof TcgdexSetBriefSchema>;

export const TcgdexSetSchema = TcgdexSetBriefSchema.extend({
  cards: z.array(TcgdexCardSchema).optional(),
});

export const TcgdexSetListSchema = z.array(TcgdexSetBriefSchema);
