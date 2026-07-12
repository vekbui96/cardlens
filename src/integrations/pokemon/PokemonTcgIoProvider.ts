import type { PokemonCardDetails, PokemonCardSummary, CardPriceResult } from "../../models/cards.ts";
import { normalizeQuery } from "../../services/search/normalize.ts";
import { rankResults } from "../../services/search/rank.ts";
import { fetchJson } from "../../services/http.ts";
import { normalizeTcgplayerPricing } from "../pricing/normalize.ts";
import {
  ProviderError,
  type CardCatalogProvider,
  type CardPricingProvider,
  type FetchOpts,
  type SearchOpts,
} from "../providers.ts";
import { CardListResponseSchema, CardResponseSchema, type RawCard } from "./schema.ts";
import { buildLuceneQuery } from "./query.ts";
import { byPriceDesc } from "./sort.ts";
import { toDetails, toRankable, toSummary } from "./map.ts";

const DEFAULT_BASE_URL = "https://api.pokemontcg.io/v2";
const PAGE_SIZE = 60;
const RESULT_LIMIT = 40;

const SELECT_FIELDS =
  "id,name,supertype,subtypes,number,artist,rarity,nationalPokedexNumbers,set,images,tcgplayer,cardmarket";

/**
 * Real catalog + pricing provider backed by pokemontcg.io v2 (open CORS, keyless).
 * Point VITE_API_BASE_URL at the server proxy to add a server-side key + cache.
 */
export class PokemonTcgIoProvider implements CardCatalogProvider, CardPricingProvider {
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(options?: { baseUrl?: string; apiKey?: string }) {
    this.baseUrl = (options?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.apiKey = options?.apiKey;
  }

  private headers(): Record<string, string> {
    return this.apiKey ? { "X-Api-Key": this.apiKey } : {};
  }

  async searchCards(query: string, opts?: SearchOpts): Promise<PokemonCardSummary[]> {
    const nq = normalizeQuery(query);
    const q = buildLuceneQuery(nq, opts?.rarities);
    if (!q) return [];

    const url =
      `${this.baseUrl}/cards?q=${encodeURIComponent(q)}` +
      `&pageSize=${PAGE_SIZE}&select=${encodeURIComponent(SELECT_FIELDS)}`;

    const json = await fetchJson(url, { signal: opts?.signal, headers: this.headers() });
    const parsed = CardListResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new ProviderError("Unexpected search response", "validation", { cause: parsed.error });
    }

    const rankable = parsed.data.data.map(toRankable);
    const ranked = rankResults(query, rankable);
    // When filtering to a chase rarity, the most valuable cards are what matter.
    const ordered = opts?.rarities && opts.rarities.length > 0 ? [...ranked].sort(byPriceDesc) : ranked;
    return ordered.slice(0, RESULT_LIMIT);
  }

  private async fetchRawCard(id: string, opts?: FetchOpts): Promise<RawCard> {
    const url = `${this.baseUrl}/cards/${encodeURIComponent(id)}`;
    const json = await fetchJson(url, { signal: opts?.signal, headers: this.headers() });
    const parsed = CardResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new ProviderError("Unexpected card response", "validation", { cause: parsed.error });
    }
    return parsed.data.data;
  }

  async getCard(id: string, opts?: FetchOpts): Promise<PokemonCardDetails> {
    return toDetails(await this.fetchRawCard(id, opts));
  }

  async getPrices(cardId: string, opts?: FetchOpts): Promise<CardPriceResult> {
    const raw = await this.fetchRawCard(cardId, opts);
    return normalizeTcgplayerPricing(raw.tcgplayer);
  }
}

export { toSummary };
