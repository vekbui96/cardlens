import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { PokemonCardSummary } from "../../../models/cards.ts";
import { FULL_SEARCH_LIMIT } from "../../../integrations/providers.ts";
import { formatCollector } from "../../../utils/format.ts";
import { useCatalogSearch } from "../../../hooks/useCatalogSearch.ts";
import { useNavigation } from "../../../app/NavigationProvider.tsx";
import { useLibrary } from "../../../app/LibraryProvider.tsx";
import {
  Card,
  CardArt,
  Chip,
  Grid,
  Money,
  Panel,
  Row,
  ScreenReaderOnly,
  Stack,
  cx,
} from "../../primitives/index.ts";
import { recallScroll, rememberScroll } from "./scrollMemory.ts";
import styles from "./SearchScreen.module.css";

/**
 * Find a card whose set you do not remember.
 *
 * ## Typing does not search. Submit does.
 *
 * This is the single decision the screen is built around, and it is structural
 * rather than a matter of discipline: the query that is fetched is the `query`
 * PROP, which only ever changes when a submit navigates. The input holds local
 * state and nothing reads it. There is no debounce to tune and no place to add
 * one without changing the shape of the screen.
 *
 * The reason is measured, not aesthetic. pokemontcg.io fails roughly a quarter
 * of the time in bursts and rate-limits on top of that, and a search is one
 * request at the API's maximum page — so a request per keystroke spends eight
 * of them, and the whole rate-limit budget, on prefixes nobody asked about. The
 * one that mattered ("charizard") is then the one that gets refused.
 *
 * ## Results are a grid, and every tile states its set
 *
 * "charizard" returns 108 cards. A list of 108 rows all reading "Charizard" is
 * not a way to find one card; the set and the collector number are what tell
 * them apart, so they are on every tile rather than behind a tap.
 */

interface SearchScreenProps {
  /** The query being shown. `""` is a real state: the screen, nothing typed. */
  query: string;
}

export function SearchScreen({ query }: SearchScreenProps) {
  const { openResults, openDetails } = useNavigation();
  const { recentSearches, addRecentSearch, clearRecentSearches } = useLibrary();
  const inputId = useId();
  const [text, setText] = useState(query);

  // Adopt the query the URL names — a pasted link, a recent search, the back
  // button. Never the other way round: local text never drives a fetch.
  useEffect(() => setText(query), [query]);

  /*
   * `full` because the point of this screen is the long tail. A 40-row answer
   * for "charizard" looks complete and silently hides 68 cards, and it is the
   * same single request either way — the page size changes, the request count
   * does not.
   */
  const search = useCatalogSearch(query, undefined, { full: true });
  const cards = useMemo(() => search.data ?? [], [search.data]);

  const run = useCallback(
    (next: string) => {
      const trimmed = next.trim();
      if (!trimmed) return;
      addRecentSearch(trimmed);
      // Re-submitting what is already on screen is a retry, not a navigation:
      // pushing an identical history entry would make Back appear to do nothing.
      if (trimmed === query) void search.refetch();
      else openResults(trimmed);
    },
    [addRecentSearch, openResults, query, search],
  );

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    run(text);
  };

  const beforeLeaving = useScrollMemory(query, cards.length > 0);

  const openCard = useCallback(
    (cardId: string, summary?: PokemonCardSummary) => {
      // Take the scroll position while the grid is still on screen — see
      // useScrollMemory for why after is too late.
      beforeLeaving();
      openDetails(cardId, summary);
    },
    [beforeLeaving, openDetails],
  );

  return (
    <Stack gap={5}>
      <h1 className={styles.title}>Search</h1>

      <form className={styles.form} role="search" onSubmit={onSubmit}>
        <label className={styles.label} htmlFor={inputId}>
          Card name or number
        </label>
        <Row gap={2} align="stretch">
          <input
            id={inputId}
            className={styles.input}
            type="search"
            name="q"
            autoComplete="off"
            enterKeyHint="search"
            placeholder="Charizard 4/102"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className={styles.primary}>
            Search
          </button>
        </Row>
        <p className={styles.hint}>
          A name, or a name and its number — “Charizard 4/102”. Nothing is fetched until you search.
        </p>
      </form>

      {query === "" ? (
        <Idle recents={recentSearches} onPick={run} onClear={clearRecentSearches} />
      ) : search.isLoading ? (
        <Searching query={query} />
      ) : search.isError ? (
        <CatalogFailure query={query} retrying={search.isFetching} onRetry={() => void search.refetch()} />
      ) : cards.length === 0 ? (
        <NoMatches query={query} />
      ) : (
        <Results query={query} cards={cards} onOpen={openCard} />
      )}
    </Stack>
  );
}

/* --- Idle ----------------------------------------------------------------- */

function Idle({
  recents,
  onPick,
  onClear,
}: {
  recents: { query: string }[];
  onPick: (query: string) => void;
  onClear: () => void;
}) {
  if (recents.length === 0) {
    return (
      <Panel title="Nothing searched yet" headingLevel={2}>
        <p className={styles.prose}>
          This is how you reach a card without knowing where it lives — 218 sets in a dropdown is not a way to
          find one card. Type a Pokémon&rsquo;s name, or a name and a collector number, and press Search.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Recent searches"
      headingLevel={2}
      aside={
        <button type="button" className={styles.quiet} onClick={onClear}>
          Clear
        </button>
      }
    >
      <Row gap={2} wrap>
        {recents.map((r) => (
          <Chip key={r.query} onPress={() => onPick(r.query)}>
            {r.query}
          </Chip>
        ))}
      </Row>
    </Panel>
  );
}

/* --- Searching ------------------------------------------------------------ */

/** Six placeholders, so the grid does not jump when the real tiles land. */
const SKELETON = [0, 1, 2, 3, 4, 5];

function Searching({ query }: { query: string }) {
  return (
    <Stack gap={3}>
      <h2 className={styles.heading}>Searching for “{query}”…</h2>
      {/*
        A skeleton in the shape of the answer, not a spinner. The catalog takes
        seconds when it is well, and a grid that appears where six grey tiles
        were is a much smaller visual event than a grid appearing from nothing.
      */}
      <div aria-busy="true" aria-live="polite">
        <ScreenReaderOnly>Searching the card catalog</ScreenReaderOnly>
        <Grid min="pocket" gap={3}>
          {SKELETON.map((i) => (
            <div key={i} className={styles.skeleton}>
              <div className={styles.skeletonArt} />
              <div className={styles.skeletonLine} />
              <div className={cx(styles.skeletonLine, styles.skeletonLineShort)} />
            </div>
          ))}
        </Grid>
      </div>
    </Stack>
  );
}

/* --- Failure -------------------------------------------------------------- */

function CatalogFailure({
  query,
  retrying,
  onRetry,
}: {
  query: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <Panel title="The card catalog did not answer" headingLevel={2} tone="raised">
      <Stack gap={3}>
        {/*
          It says what could not be reached and does NOT blame the query. The
          catalog fails about a quarter of the time in bursts, so "no results,
          check your spelling" would be wrong far more often than it was right —
          and it would send people to correct a word that was already correct.
        */}
        <p className={styles.prose}>
          There is nothing wrong with “{query}”. pokemontcg.io drops requests in bursts and rate-limits on top
          of that, so the same search usually works a moment later.
        </p>
        <Row gap={2}>
          <button type="button" className={styles.primary} onClick={onRetry} disabled={retrying}>
            {retrying ? "Trying again…" : "Try again"}
          </button>
        </Row>
      </Stack>
    </Panel>
  );
}

/* --- No matches ----------------------------------------------------------- */

function NoMatches({ query }: { query: string }) {
  return (
    <Panel title={`Nothing matched “${query}”`} headingLevel={2}>
      <p className={styles.prose}>
        The catalog answered, and it has no card by that name — this is an empty answer, not a failure. Check
        the spelling, drop a suffix like “ex” or “VMAX”, or search the Pokémon&rsquo;s name on its own.
      </p>
    </Panel>
  );
}

/* --- Results -------------------------------------------------------------- */

function Results({
  query,
  cards,
  onOpen,
}: {
  query: string;
  cards: PokemonCardSummary[];
  onOpen: (cardId: string, summary?: PokemonCardSummary) => void;
}) {
  return (
    <Stack gap={3}>
      <h2 className={styles.heading}>
        {cards.length} {cards.length === 1 ? "card" : "cards"} for “{query}”
      </h2>
      {cards.length >= FULL_SEARCH_LIMIT ? (
        // A full page back is indistinguishable from a complete answer, so say
        // which one this is rather than implying the catalog stops there.
        <p className={styles.hint}>That is the first page — add a word to narrow it.</p>
      ) : null}
      <Grid min="pocket" gap={3}>
        {cards.map((card) => (
          <ResultTile key={card.id} card={card} onOpen={onOpen} />
        ))}
      </Grid>
    </Stack>
  );
}

function ResultTile({
  card,
  onOpen,
}: {
  card: PokemonCardSummary;
  onOpen: (cardId: string, summary?: PokemonCardSummary) => void;
}) {
  return (
    /*
     * A button rather than a link, so the summary can travel with the
     * navigation. Details refetches by id anyway, but the catalog fails often
     * enough that a details screen which cannot even name its card is a real
     * state — and the summary is what lets it paint the header regardless.
     */
    <Card onPress={() => onOpen(card.id, card)} className={styles.tile}>
      <CardArt src={card.imageSmall} name={card.name} detail="tile" decorative />
      <span className={styles.name}>{card.name}</span>
      {/*
        The set and the number, on every tile. "charizard" returns 108 cards and
        the name is identical on most of them; this is the part that tells one
        from another, so it is not behind a tap.
      */}
      <span className={styles.set}>{card.setName}</span>
      <span className={styles.meta}>
        <span className={styles.number}>#{formatCollector(card.collectorNumber)}</span>
        <Money value={card.marketPrice} absentLabel="n/a" />
      </span>
    </Card>
  );
}

/* --- Scroll ---------------------------------------------------------------- */

/**
 * Keep the results scrolled where they were left.
 *
 * Restores once per query, on the first render that actually has tiles, in a
 * layout effect — before paint, so there is no visible jump.
 *
 * Recording is the part that is not obvious. The position must be taken **at
 * the moment the card is pressed**, not on the way out, because by the time an
 * effect cleanup runs the details screen has already replaced the grid, the
 * document is a fraction of its height, and the browser has clamped `scrollY`
 * to fit it. Measured here at 390x500: leaving at 812 and reading the position
 * in the cleanup gave 632 — a position that was never anywhere the user was.
 *
 * The scroll listener is still there, for the cases a press never happens: a
 * reload, a tab switch, following a link out. It is silenced from the press
 * onwards for exactly the same reason — the clamp fires a scroll event of its
 * own, and that event is not a position anyone chose.
 *
 * Returns what to call before navigating away.
 */
function useScrollMemory(query: string, hasResults: boolean): () => void {
  const restoredFor = useRef<string | null>(null);
  const leaving = useRef(false);

  useLayoutEffect(() => {
    if (!hasResults || restoredFor.current === query) return;
    restoredFor.current = query;
    const y = recallScroll(query);
    if (y > 0) window.scrollTo(0, y);
  }, [query, hasResults]);

  useEffect(() => {
    if (!query) return;
    let frame = 0;
    const onScroll = () => {
      if (leaving.current || frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (!leaving.current) rememberScroll(query, window.scrollY);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, [query]);

  return useCallback(() => {
    leaving.current = true;
    rememberScroll(query, window.scrollY);
  }, [query]);
}
