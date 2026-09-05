import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLibrary } from "../../../app/LibraryProvider.tsx";
import { useNavigation } from "../../../app/NavigationProvider.tsx";
import { screenToPath } from "../../../app/screenUrl.ts";
import { RARITY_FILTERS, filterByRarity } from "../../../features/results/rarityFilters.ts";
import { useCatalogSearch } from "../../../hooks/useCatalogSearch.ts";
import { POPULAR_POKEMON } from "../../../integrations/pokemon/fixtures.ts";
import type { CollectFinish, PokemonCardSummary } from "../../../models/cards.ts";
import { Chip, Grid, Panel, Row, ScreenReaderOnly, Stack, cx } from "../../primitives/index.ts";
import { ResultTile } from "./ResultTile.tsx";
import {
  failureNote,
  nothingMatched,
  recentQueries,
  resultSummary,
  searchPhase,
  searchable,
  truncationNote,
} from "./searchState.ts";
import styles from "./Results.module.css";

/** One id, one document: there is only ever one search box on screen. */
const INPUT_ID = "v2-search-query";

/**
 * Search: find a card whose set you do not remember.
 *
 * This is the only way to reach a card without knowing where it lives. 218 sets
 * in a dropdown is not a way to find one card, and the set grid cannot help you
 * if the thing you remember is "a Charizard, the one with the orange sky".
 *
 * ## Typing does not search. Submit does.
 *
 * The box holds a DRAFT in local state; the query that is actually searched
 * comes from the screen — which is to say, from the URL. Nothing happens until
 * the form is submitted, and that is not a performance nicety: pokemontcg.io
 * fails roughly a quarter of the time in bursts and rate-limits on top of that,
 * so a request per keystroke spends the entire budget on prefixes nobody asked
 * about and then fails the search the user actually meant. Eight characters cost
 * zero requests here; submitting costs one.
 *
 * A submit navigates, so every search is a history entry and Back undoes the
 * last one. That is honest precisely BECAUSE typing does not search: every entry
 * in the history is a deliberate press, not a prefix the browser recorded on the
 * way past.
 *
 * ## The request budget
 *
 * ONE catalog request per submitted query, and nothing else on this screen —
 * the rarity chips filter IN MEMORY over the list already in hand. v1 hands
 * `rarities` down to the query, which makes each chip a fresh round trip
 * against the flakiest endpoint in the app for a list the browser is already
 * holding. `filterByRarity` is the same predicate the API applies, so nothing
 * changes except the number of requests, which goes to zero.
 *
 * `full: true` is the one thing asked of the provider. The default answer is
 * the top 40, which is right on the glasses — a focus ring stepped one card at
 * a time, where the 41st Charizard is a punishment — and wrong here, where
 * there is a grid and a scrollbar. It is the same single request either way.
 */
export function ResultsScreen({ query }: { query: string }) {
  const { recentSearches, addRecentSearch, clearRecentSearches, ownedFinishes } = useLibrary();
  const { push, openDetails } = useNavigation();

  const [draft, setDraft] = useState(query);
  const [rarityKey, setRarityKey] = useState("all");
  const rarity = RARITY_FILTERS.find((f) => f.key === rarityKey) ?? RARITY_FILTERS[0];

  /*
   * The box follows the screen. Arriving from a recent-search link, from the
   * browser's Back button, or from a pasted URL must put that query in the box —
   * otherwise the box and the results below it disagree about what was searched,
   * and the next submit silently searches something else.
   */
  useEffect(() => setDraft(query), [query]);

  /*
   * Recorded on ARRIVAL, not on submit.
   *
   * Every route into this screen is a search worth remembering: a typed query, a
   * recent-search link, a pasted URL, a name tapped through from card details.
   * Recording it at the one place they all pass through is what stops the list
   * being a partial record of only the searches that happened to start here.
   */
  useEffect(() => {
    if (searchable(query)) addRecentSearch(query.trim());
  }, [query, addRecentSearch]);

  const search = useCatalogSearch(query, undefined, { full: true });
  const cards = useMemo(() => search.data ?? [], [search.data]);
  const matched = useMemo(() => filterByRarity(cards, rarity.rarities), [cards, rarity.rarities]);

  const phase = searchPhase({
    query,
    answered: search.data !== undefined,
    // Default `networkMode` PAUSES a query offline rather than failing it, so
    // without this an offline search is a skeleton that never resolves.
    paused: search.fetchStatus === "paused",
    isError: search.isError,
    total: cards.length,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = draft.trim();
    if (!searchable(next)) return;
    push({ name: "results", query: next });
  };

  return (
    <Stack gap={5}>
      <header>
        <Stack gap={3}>
          {/*
            The query is the title once there is one. A page headed "Search" that
            is showing results for something is a page you cannot tell apart from
            the next one in the browser's history.
          */}
          <h1 className={styles.title}>{phase === "idle" ? "Search cards" : `“${query.trim()}”`}</h1>

          <form className={styles.form} role="search" onSubmit={submit}>
            <Row gap={2} align="center">
              {/*
                The label is real but hidden: the `<h1>` directly above already
                says "Search cards" to a sighted reader, and two of the same
                words stacked is noise. A screen reader still gets a named field
                rather than an unlabelled box with a placeholder.
              */}
              <label htmlFor={INPUT_ID}>
                <ScreenReaderOnly>Search cards</ScreenReaderOnly>
              </label>
              <input
                id={INPUT_ID}
                className={styles.input}
                type="search"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="e.g. Charizard ex, or 4/102"
                autoComplete="off"
                enterKeyHint="search"
              />
              {/*
                Disabled on exactly the predicate the query hook enables on. A
                live button over a box holding "  " would navigate to a screen
                whose query can never run — a skeleton that spins forever, which
                looks like the app working.
              */}
              <button type="submit" className={styles.submit} disabled={!searchable(draft)}>
                Search
              </button>
            </Row>
          </form>
        </Stack>
      </header>

      {phase === "idle" ? (
        <Idle
          recents={recentQueries(recentSearches)}
          onClear={clearRecentSearches}
          onPick={(q) => push({ name: "results", query: q })}
        />
      ) : null}

      {/*
        Only over a list there is something to filter. Chips above an error or an
        empty result are five controls that cannot change the answer.
      */}
      {phase === "results" ? (
        <Row gap={2} wrap>
          <div className={styles.chips} role="group" aria-label="Filter by rarity">
            {RARITY_FILTERS.map((f) => (
              <Chip
                key={f.key}
                onPress={() => setRarityKey(f.key)}
                pressed={f.key === rarityKey}
                tone={f.key === rarityKey ? "accent" : "default"}
                label={f.label}
              >
                {f.short}
              </Chip>
            ))}
          </div>
        </Row>
      ) : null}

      {phase === "searching" ? <ResultsSkeleton /> : null}

      {phase === "offline" || phase === "failed" ? (
        <Failure phase={phase} onRetry={() => void search.refetch()} />
      ) : null}

      {phase === "empty" ? (
        <Panel title={nothingMatched(query)} headingLevel={2}>
          <Stack gap={3}>
            {/*
              Says what the catalog does and does not index, rather than telling
              the reader to check their spelling — which is what v1 said whatever
              had actually happened, including when the network was down.
            */}
            <p className={styles.note}>
              The catalog has nothing under that name or number. A Pokémon’s name on its own finds the most —
              “Charizard” rather than “charizard vmax rainbow” — and a collector number works too, as
              <code> 4/102</code> or just <code> 25</code>.
            </p>
          </Stack>
        </Panel>
      ) : null}

      {phase === "results" ? (
        <Results
          cards={matched}
          total={cards.length}
          rarityLabel={rarity.rarities === null ? null : rarity.label}
          ownedFinishes={ownedFinishes}
          onOpen={openDetails}
        />
      ) : null}
    </Stack>
  );
}

/* --- Idle ----------------------------------------------------------------- */

/**
 * The screen before anything has been searched.
 *
 * An idle search box with nothing under it is a dead end that asks the reader to
 * think of something. Recent searches answer "what was I doing", and the popular
 * names answer "what can I even ask for" — which matters because the query
 * language here is not obvious: a bare collector number is a search, and a
 * Pokémon name finds more than a name plus three adjectives.
 *
 * Both are LINKS, not buttons: each is a real URL that can be copied and opened
 * in a tab, and arriving there records the search on its own — see the effect in
 * the screen above. They are intercepted for the same reason the shell
 * intercepts its nav, so a plain click does not go through a hashchange.
 */
function Idle({
  recents,
  onClear,
  onPick,
}: {
  recents: string[];
  onClear: () => void;
  onPick: (query: string) => void;
}) {
  return (
    <Stack gap={4}>
      {recents.length > 0 ? (
        <Panel
          title="Recent searches"
          headingLevel={2}
          aside={<Chip onPress={onClear}>Clear</Chip>}
          tone="quiet"
        >
          <QueryList queries={recents} onPick={onPick} label="Recent searches" />
        </Panel>
      ) : null}

      <Panel title="Popular" headingLevel={2} tone="quiet">
        <Stack gap={3}>
          <p className={styles.note}>
            A Pokémon’s name finds every card it has ever appeared on. A collector number finds one printing —
            try <code>4/102</code>.
          </p>
          <QueryList queries={[...POPULAR_POKEMON]} onPick={onPick} label="Popular searches" />
        </Stack>
      </Panel>
    </Stack>
  );
}

function QueryList({
  queries,
  onPick,
  label,
}: {
  queries: string[];
  onPick: (query: string) => void;
  label: string;
}) {
  return (
    <ul className={styles.recentList} aria-label={label}>
      {queries.map((q) => (
        <li key={q}>
          <a
            className={styles.queryLink}
            href={`#${screenToPath({ name: "results", query: q })}`}
            onClick={(e) => {
              if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
                return;
              }
              e.preventDefault();
              onPick(q);
            }}
          >
            {q}
          </a>
        </li>
      ))}
    </ul>
  );
}

/* --- Results -------------------------------------------------------------- */

function Results({
  cards,
  total,
  rarityLabel,
  ownedFinishes,
  onOpen,
}: {
  cards: PokemonCardSummary[];
  total: number;
  rarityLabel: string | null;
  ownedFinishes: (id: string) => CollectFinish[];
  onOpen: (cardId: string, summary: PokemonCardSummary) => void;
}) {
  const summary = resultSummary(total, cards.length, rarityLabel);
  const truncated = truncationNote(total);

  if (summary.empty) {
    return (
      <Panel title={summary.title} headingLevel={2}>
        <p className={styles.note}>{summary.hint}</p>
      </Panel>
    );
  }

  return (
    <Stack gap={3}>
      <h2 className={styles.count}>{summary.title}</h2>
      {/* A slice that looks like the whole answer is the one lie a result count
          can tell, so the count says when it is one. */}
      {truncated ? <p className={cx(styles.count, styles.countWarn)}>{truncated}</p> : null}

      <Grid as="ul" min="pocket" gap={3} className={styles.grid}>
        {cards.map((card) => (
          <ResultTile
            key={card.id}
            card={card}
            owned={ownedFinishes(card.id).length}
            onOpen={() => onOpen(card.id, card)}
          />
        ))}
      </Grid>
    </Stack>
  );
}

/* --- Failure -------------------------------------------------------------- */

/**
 * Offline and "the catalog fell over" get different words on purpose.
 *
 * They look identical from here — no results, no error the user can act on —
 * and they mean opposite things. A retry works for one and cannot possibly work
 * for the other, so offering the same button for both trains people to press it
 * pointlessly. Neither blames the reader for what they typed.
 */
function Failure({ phase, onRetry }: { phase: "offline" | "failed"; onRetry: () => void }) {
  const note = failureNote(phase);
  return (
    <Panel title={note.title} headingLevel={2} tone="raised" className={styles.warnPanel}>
      <Stack gap={3}>
        <p className={styles.note}>{note.detail}</p>
        {phase === "failed" ? (
          <Row>
            <Chip onPress={onRetry}>Try again</Chip>
          </Row>
        ) : null}
      </Stack>
    </Panel>
  );
}

/* --- Skeleton ------------------------------------------------------------- */

/**
 * The shape of the content: a grid of card-shaped tiles.
 *
 * Twelve, because that is roughly a screenful at both widths and the count is
 * unknowable in advance. It says what is about to be there rather than that
 * something is happening, and nothing jumps when the answer lands.
 */
function ResultsSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <ScreenReaderOnly>Searching the catalog</ScreenReaderOnly>
      <Grid min="pocket" gap={3}>
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} className={styles.skeletonTile} />
        ))}
      </Grid>
    </div>
  );
}
