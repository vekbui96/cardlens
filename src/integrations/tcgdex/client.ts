import { ProviderError } from "../providers.ts";
import { TcgdexCardSchema, TcgdexSetListSchema, TcgdexSetSchema, type TcgdexCard } from "./schema.ts";

const TCGDEX_BASE = "https://api.tcgdex.net/v2/en";

/**
 * pokemontcg.io set ids do not always match TCGdex's. Measured over the full
 * lists: 167 of 174 join on a normalised name, and card numbers then resolve to
 * localId for 1183 of 1184 sampled cards. These are the ones name matching
 * cannot reach — em-dashes, promos, and energies.
 *
 * Note "me5" vs "me05": zero padding differs, which is exactly why matching is
 * by name rather than by id.
 */
const SET_ID_OVERRIDES: Record<string, string> = {
  base1: "base1",
  hgss2: "hgss2",
  hgss3: "hgss3",
  hgss4: "hgss4",
};

/** One printing of a card: a type, optionally with a foil pattern. */
export interface Printing {
  /** normal | reverse | holo | firstEdition | ... */
  type: string;
  /** pokeball, masterball, energy, cosmos, ... when patterned. */
  foil?: string;
}

export interface SetPrintings {
  /** TCGdex set id this came from. */
  tcgdexSetId: string;
  /** Keyed by pokemontcg.io collector number, which is how cards arrive here. */
  byNumber: Record<string, Printing[]>;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { ...(signal ? { signal } : {}) });
  } catch (err) {
    throw new ProviderError("tcgdex unreachable", "network", { cause: err });
  }
  if (!res.ok) {
    throw new ProviderError(`tcgdex responded ${res.status}`, res.status === 404 ? "not-found" : "unknown");
  }
  return (await res.json()) as unknown;
}

export class TcgdexClient {
  private setListPromise: Promise<Map<string, string>> | null = null;

  constructor(private readonly base: string = TCGDEX_BASE) {}

  /** normalised set name -> TCGdex set id. Fetched once and reused. */
  private setsByName(signal?: AbortSignal): Promise<Map<string, string>> {
    // Cached as the in-flight promise, so concurrent set views share one fetch
    // rather than each pulling the whole 218-set list.
    this.setListPromise ??= (async () => {
      const parsed = TcgdexSetListSchema.safeParse(await fetchJson(`${this.base}/sets`, signal));
      if (!parsed.success) throw new ProviderError("tcgdex set list malformed", "validation");
      const map = new Map<string, string>();
      for (const set of parsed.data) {
        const key = normalizeName(set.name);
        // First wins: the list is chronological and re-releases reuse names.
        if (!map.has(key)) map.set(key, set.id);
      }
      return map;
    })().catch((err: unknown) => {
      // Never cache a failure, or one flaky call disables printings for the
      // whole session.
      this.setListPromise = null;
      throw err;
    });
    return this.setListPromise;
  }

  /** Resolve a pokemontcg.io set (id + name) to a TCGdex set id. */
  async resolveSetId(ptcgSetId: string, setName: string, signal?: AbortSignal): Promise<string | null> {
    const override = SET_ID_OVERRIDES[ptcgSetId];
    if (override) return override;
    const byName = await this.setsByName(signal);
    return byName.get(normalizeName(setName)) ?? null;
  }

  /**
   * Every printing in a set, keyed by collector number.
   *
   * Verified against the live API: the set endpoint's embedded cards carry only
   * `id, image, localId, name`, and the filtered `/cards?set=` list is the same
   * brief shape. Variants exist ONLY on the individual card endpoint, so a
   * set-wide answer costs one request per card — 120 for Pitch Black, 295 for
   * Ascended Heroes.
   *
   * Hence the concurrency cap and the expectation that callers cache the
   * result: this is a background enrichment, not something to sit on a spinner
   * for. Individual card failures are skipped rather than failing the set,
   * because a partial denominator still beats none.
   */
  async getSetPrintings(
    ptcgSetId: string,
    setName: string,
    opts: { signal?: AbortSignal; concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
  ): Promise<SetPrintings | null> {
    const { signal, concurrency = 6, onProgress } = opts;
    const tcgdexSetId = await this.resolveSetId(ptcgSetId, setName, signal);
    if (!tcgdexSetId) return null;

    const parsed = TcgdexSetSchema.safeParse(
      await fetchJson(`${this.base}/sets/${encodeURIComponent(tcgdexSetId)}`, signal),
    );
    if (!parsed.success) throw new ProviderError("tcgdex set malformed", "validation");

    const briefs = parsed.data.cards ?? [];
    const byNumber: Record<string, Printing[]> = {};
    let done = 0;
    let cursor = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        const index = cursor++;
        const brief = briefs[index];
        if (!brief) return;
        if (signal?.aborted) return;
        try {
          const card = TcgdexCardSchema.safeParse(
            await fetchJson(`${this.base}/cards/${encodeURIComponent(brief.id)}`, signal),
          );
          if (card.success) {
            const printings = toPrintings(card.data);
            // localId lives on the brief; the detail echoes it, but the brief is
            // the one guaranteed present.
            if (printings.length > 0) {
              for (const key of numberKeys({ ...card.data, localId: brief.localId })) {
                byNumber[key] = printings;
              }
            }
          }
        } catch {
          // One card missing is a gap in the denominator, not a failed set.
        }
        onProgress?.(++done, briefs.length);
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, briefs.length) }, worker));
    return { tcgdexSetId, byNumber };
  }
}

/**
 * Both the padded and unpadded forms are indexed ("001" and "1"), because
 * TCGdex pads modern sets while pokemontcg.io does not.
 */
function numberKeys(card: TcgdexCard): string[] {
  const raw = card.localId === undefined ? "" : String(card.localId);
  if (!raw) return [];
  const trimmed = raw.replace(/^0+(?=\d)/, "");
  return raw === trimmed ? [raw] : [raw, trimmed];
}

function toPrintings(card: TcgdexCard): Printing[] {
  const seen = new Set<string>();
  const out: Printing[] = [];
  for (const variant of card.variants_detailed ?? []) {
    const key = `${variant.type}|${variant.foil ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: variant.type, ...(variant.foil ? { foil: variant.foil } : {}) });
  }
  return out;
}
