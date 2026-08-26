import { CardImage } from "../../components/CardImage.tsx";
import { useCatalogSearch } from "../../hooks/useCatalogSearch.ts";
import type { CollectFinish, PokemonCardSummary } from "../../models/cards.ts";
import { FULL_SEARCH_LIMIT } from "../../integrations/providers.ts";
import styles from "./WebBinderScreen.module.css";

/**
 * Find a card to put in a pocket without knowing which set it is in.
 *
 * The set list below answers "fill this binder from one set", which is how a
 * master-set binder is built. It cannot answer "where does my Umbreon VMAX go"
 * — that means remembering the set, finding it among 218 in a dropdown, and
 * then finding the card. Searching by name skips all of it.
 *
 * Two taps rather than one, because a result carries no trustworthy printing
 * list with it: pick the card, then pick the printing in the sheet below, once
 * the oracle has answered for that card's set alone.
 */
export function BinderSearchResults({
  query,
  ownedFinishes,
  onChoose,
  compact = false,
}: {
  query: string;
  ownedFinishes: (cardId: string) => CollectFinish[];
  onChoose: (card: PokemonCardSummary) => void;
  /**
   * Collapse to one sideways row.
   *
   * Set once a card is chosen, because the sheet asking which printing then
   * needs the height. A phone cannot show the binder page, a grid of 44
   * results and the question at once — and of the three, the grid is the one
   * whose job is already done.
   */
  compact?: boolean;
}) {
  // Every printing of that Pokémon, not the top 40. The short list is right for
  // a focus ring on the glasses and wrong here: "where does my Charizard go" is
  // a question about the 108 that exist, and the one you mean is rarely in the
  // first handful.
  const { data, isLoading, isError, refetch } = useCatalogSearch(query, undefined, { full: true });

  if (isLoading) return <p className={styles.hint}>Searching…</p>;

  if (isError) {
    // pokemontcg.io fails around a quarter of the time, in bursts. A retry is
    // the whole remedy, so it is offered inline rather than as an apology.
    return (
      <p className={styles.hint} role="alert">
        Search failed.{" "}
        <button type="button" className={styles.linkButton} onClick={() => refetch()}>
          Try again
        </button>
      </p>
    );
  }

  const results = data ?? [];
  if (results.length === 0) {
    return <p className={styles.hint}>No cards match “{query}”. Check the spelling, or search by Pokémon.</p>;
  }

  return (
    <>
      {compact ? null : (
        <p className={styles.hint}>
          {results.length} card{results.length === 1 ? "" : "s"} match “{query}”, closest match first.
          {/* A full page back is indistinguishable from a complete answer, so
              say which one this is rather than implying the catalog stops
              there. */}
          {results.length >= FULL_SEARCH_LIMIT ? " That is the first page — add a word to narrow it." : ""}
        </p>
      )}
      <ul className={compact ? styles.cards : styles.grid}>
        {results.map((card) => {
          const owned = ownedFinishes(card.id).length > 0;
          return (
            <li key={card.id}>
              <button
                type="button"
                className={`${styles.card} ${owned ? "" : styles.cardWanted}`}
                aria-label={`${card.name}, ${card.collectorNumber}, ${card.setName}, ${
                  owned ? "owned" : "not owned"
                }`}
                onClick={() => onChoose(card)}
              >
                <CardImage src={card.imageSmall} alt="" size="thumb" />
                {/* Two lines, not one: a result's set is the thing that tells
                    two otherwise identical Charizards apart, and squeezed onto
                    the number's line it is the half that gets ellipsised. */}
                <span className={styles.cardMeta}>{card.collectorNumber}</span>
                <span className={styles.cardSet}>{card.setName}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
