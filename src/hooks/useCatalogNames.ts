import { useQuery } from "@tanstack/react-query";
import { useCatalog } from "../app/contexts.tsx";
import { companionBase } from "../services/companionApi.ts";
import { shouldUseMocks } from "../integrations/pokemon/index.ts";
import { fetchJson } from "../services/http.ts";

/** What a My cards row needs from the catalog: the rest of the row is ours. */
export interface CatalogCardName {
  name: string;
  number: string;
  image?: string;
  large?: string;
}

export interface CatalogNames {
  /** Card id -> name, number and art, across every set asked about. */
  cards: Map<string, CatalogCardName>;
  /** Sets the server could not name. Only these are asked for set by set. */
  missing: Set<string>;
}

/**
 * Names, collector numbers and art for every card in the given sets, in ONE
 * request to `/api/catalog/names`.
 *
 * My cards used to learn these with one `getCardsBySet` per owned set — about
 * nineteen at once, through a proxy with a 60-second cache, against an upstream
 * that fails ~25% of the time — and the device keeps only eight sets of card
 * lists, so nearly every cold open paid for nearly all of them. This is the
 * fix `useCatalogPrices` already is for Home's total, applied to the names.
 *
 * `live` is false under mocks and DevPanel simulations, where the provider is a
 * mock this endpoint knows nothing about; the caller then uses the per-set path,
 * as it does for an older server (an error) and for sets named in `missing`.
 */
export function useCatalogNames(setIds: string[]) {
  const { sourceKey } = useCatalog();
  const live = sourceKey === "base" && !shouldUseMocks();
  const key = setIds.join(",");

  const query = useQuery<CatalogNames>({
    queryKey: ["catalog-names", key],
    queryFn: ({ signal }) => loadCatalogNames(setIds, signal),
    enabled: live && setIds.length > 0,
    staleTime: 30 * 60_000,
    retry: 1,
  });

  return { live, query };
}

/**
 * Exported so it can be tested directly: the hook switches off under mocks, so
 * driving it through React alone would never exercise the parsing.
 *
 * Throws on a non-2xx (an older server answers 404), so the caller can fall
 * back. A 200 of the wrong shape returns nothing named and every set missing,
 * which falls back the same way rather than listing bare ids as truth.
 */
export async function loadCatalogNames(setIds: string[], signal?: AbortSignal): Promise<CatalogNames> {
  const url = `${companionBase()}/catalog/names?sets=${encodeURIComponent(setIds.join(","))}`;
  const body = (await fetchJson(url, { timeoutMs: 20_000, ...(signal ? { signal } : {}) })) as {
    cards?: unknown;
    missing?: unknown;
  } | null;

  const raw = body?.cards;
  if (!raw || typeof raw !== "object") return { cards: new Map(), missing: new Set(setIds) };

  const cards = new Map<string, CatalogCardName>();
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const v = value as { name?: unknown; number?: unknown; image?: unknown; large?: unknown } | null;
    if (!v || typeof v.name !== "string" || !v.name) continue;
    cards.set(id, {
      name: v.name,
      number: typeof v.number === "string" ? v.number : "",
      ...(typeof v.image === "string" && v.image ? { image: v.image } : {}),
      ...(typeof v.large === "string" && v.large ? { large: v.large } : {}),
    });
  }

  const missing = new Set(
    Array.isArray(body?.missing) ? body.missing.filter((s): s is string => typeof s === "string") : [],
  );
  return { cards, missing };
}
