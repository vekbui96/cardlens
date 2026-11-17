import type {
  PokemonCardDetails,
  PokemonCardSummary,
  CardPriceResult,
  PokemonSet,
} from "../../models/cards.ts";
import { normalizeQuery } from "../../services/search/normalize.ts";
import { rankResults } from "../../services/search/rank.ts";
import { fetchJson } from "../../services/http.ts";
import { normalizeTcgplayerPricing } from "../pricing/normalize.ts";
import {
  ProviderError,
  FULL_SEARCH_LIMIT,
  type CardCatalogProvider,
  type CardPricingProvider,
  type FetchOpts,
  type SearchOpts,
} from "../providers.ts";
import { CardListResponseSchema, CardResponseSchema, SetListResponseSchema, type RawCard } from "./schema.ts";
import { buildLuceneQuery, escapeSetId } from "./query.ts";
import { byPriceDesc } from "./sort.ts";
import { toDetails, toRankable, toSet, toSummary } from "./map.ts";

const DEFAULT_BASE_URL = "https://api.pokemontcg.io/v2";
const PAGE_SIZE = 60;
const RESULT_LIMIT = 40;
/**
 * A `full` search is ONE request at the API's maximum page, never paged.
 *
 * Measured against the live API, the busiest Pokémon names fit inside it —
 * pikachu 177, mew 135, charizard 108, eevee 85, umbreon 44. Paging past it
 * would spend extra requests on an endpoint that fails ~25% of the time in
 * bursts, to complete queries so broad ("c*") that nobody reads the tail.
 */
const FULL_PAGE_SIZE = FULL_SEARCH_LIMIT;
const SET_PAGE_SIZE = 250;
/** A guard, not a limit: no real set is near 2,500 cards. */
const MAX_SET_PAGES = 10;

const SELECT_FIELDS =
  "id,name,supertype,subtypes,number,artist,rarity,nationalPokedexNumbers,set,images,tcgplayer,cardmarket";
const SET_SELECT_FIELDS = "id,name,series,releaseDate,total,printedTotal,ptcgoCode,images";

/**
 * Real catalog + pricing provider backed by pokemontcg.io v2 (open CORS, keyless).
 * Point VITE_API_BASE_URL at the server proxy to add a server-side key + cache.
 */
export class PokemonTcgIoProvider implements CardCatalogProvider, CardPricingProvider {
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  /**
   * Public API to fall back to when the proxy is unreachable.
   *
   * The proxy is preferred because it retries pokemontcg.io's bursty 5xx and
   * serves stale cache when upstream is down — resilience the browser cannot
   * replicate. But it lives on a home server that is sometimes off, and losing
   * the whole catalog because of that would be a worse failure than the one
   * being fixed. Empty when no proxy is configured.
   */
  private readonly fallbackBaseUrl: string;

  constructor(options?: { baseUrl?: string; apiKey?: string }) {
    this.baseUrl = (options?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fallbackBaseUrl = this.baseUrl === DEFAULT_BASE_URL ? "" : DEFAULT_BASE_URL;
    this.apiKey = options?.apiKey;
  }

  /**
   * Fetch, retrying against the public API if the proxy fails. A proxy that is
   * merely slow still wins, because it is the one that can serve stale data.
   */
  private async get(url: string, signal?: AbortSignal): Promise<unknown> {
    try {
      return await fetchJson(url, { ...(signal ? { signal } : {}), headers: this.headers() });
    } catch (err) {
      if (!this.fallbackBaseUrl || !url.startsWith(this.baseUrl)) throw err;
      const retryUrl = this.fallbackBaseUrl + url.slice(this.baseUrl.length);
      return fetchJson(retryUrl, { ...(signal ? { signal } : {}), headers: this.headers() });
    }
  }

  private headers(): Record<string, string> {
    return this.apiKey ? { "X-Api-Key": this.apiKey } : {};
  }

  async searchCards(query: string, opts?: SearchOpts): Promise<PokemonCardSummary[]> {
    const nq = normalizeQuery(query);
    const q = buildLuceneQuery(nq, opts?.rarities);
    if (!q) return [];

    const pageSize = opts?.full ? FULL_PAGE_SIZE : PAGE_SIZE;
    const url =
      `${this.baseUrl}/cards?q=${encodeURIComponent(q)}` +
      `&pageSize=${pageSize}&select=${encodeURIComponent(SELECT_FIELDS)}`;

    const json = await this.get(url, opts?.signal);
    const parsed = CardListResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new ProviderError("Unexpected search response", "validation", { cause: parsed.error });
    }

    const rankable = parsed.data.data.map(toRankable);
    const ranked = rankResults(query, rankable);
    // When filtering to a chase rarity, the most valuable cards are what matter.
    const ordered = opts?.rarities && opts.rarities.length > 0 ? [...ranked].sort(byPriceDesc) : ranked;
    return opts?.full ? ordered : ordered.slice(0, RESULT_LIMIT);
  }

  async listSets(opts?: FetchOpts): Promise<PokemonSet[]> {
    const url =
      `${this.baseUrl}/sets?orderBy=-releaseDate` +
      `&pageSize=${SET_PAGE_SIZE}&select=${encodeURIComponent(SET_SELECT_FIELDS)}`;
    const json = await this.get(url, opts?.signal);
    const parsed = SetListResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new ProviderError("Unexpected sets response", "validation", { cause: parsed.error });
    }
    return parsed.data.data.map(toSet);
  }

  async getCardsBySet(setId: string, opts?: SearchOpts): Promise<PokemonCardSummary[]> {
    const clauses = [`set.id:${escapeSetId(setId)}`];
    if (opts?.rarities && opts.rarities.length > 0) {
      clauses.push(`(${opts.rarities.map((r) => `rarity:"${r}"`).join(" OR ")})`);
    }
    const base =
      `${this.baseUrl}/cards?q=${encodeURIComponent(clauses.join(" "))}` +
      `&pageSize=${SET_PAGE_SIZE}&orderBy=number&select=${encodeURIComponent(SELECT_FIELDS)}`;

    /*
     * EVERY page, not the first. 250 is the upstream maximum, so one request
     * cut Paldea Evolved at 250 of 279, Fusion Strike at 250 of 284 — and the
     * cards past it are the secret rares, which then showed in My cards as bare
     * ids. Same loop as the server's set-information route.
     *
     * A proxy that predates paging ignores `page` and answers page 1 every
     * time; the echoed `page` catches that after one extra request, and the
     * de-dupe by id keeps the result exactly what it was before this change.
     * A failed later page fails the whole read rather than caching part of a
     * set as all of it.
     */
    const byId = new Map<string, RawCard>();
    for (let page = 1; page <= MAX_SET_PAGES; page++) {
      const json = await this.get(`${base}&page=${page}`, opts?.signal);
      const parsed = CardListResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new ProviderError("Unexpected set-cards response", "validation", { cause: parsed.error });
      }
      if (parsed.data.page !== undefined && parsed.data.page !== page) break;
      for (const card of parsed.data.data) if (!byId.has(card.id)) byId.set(card.id, card);
      if (parsed.data.data.length < SET_PAGE_SIZE) break;
      if (page === MAX_SET_PAGES) {
        console.warn("[cardlens] getCardsBySet hit the page cap; the set may be truncated:", setId);
      }
    }
    // Browsing a set: surface the most valuable cards (chase cards) first.
    return [...byId.values()].map(toSummary).sort(byPriceDesc);
  }

  private async fetchRawCard(id: string, opts?: FetchOpts): Promise<RawCard> {
    const url = `${this.baseUrl}/cards/${encodeURIComponent(id)}`;
    const json = await this.get(url, opts?.signal);
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
