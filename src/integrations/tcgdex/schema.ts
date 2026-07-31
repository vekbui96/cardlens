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
});
export type TcgdexVariant = z.infer<typeof TcgdexVariantSchema>;

export const TcgdexCardSchema = z.object({
  id: z.string(),
  localId: z.union([z.string(), z.number()]).optional(),
  name: z.string().optional(),
  rarity: z.string().optional(),
  variants_detailed: z.array(TcgdexVariantSchema).optional(),
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
