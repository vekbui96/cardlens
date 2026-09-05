import { useEffect, useMemo, useRef } from "react";
import type { PokemonCardSummary } from "../../../models/cards.ts";
import type { Finish } from "../../../models/finishes.ts";
import { finishLabel } from "../../../models/finishes.ts";
import { catalogPrice, catalogPriceIndex } from "../../../models/catalogPrice.ts";
import { printingPrice } from "../../../models/printingIndex.ts";
import { setIdFromCardId } from "../../../utils/cardId.ts";
import { formatCollector } from "../../../utils/format.ts";
import { useCardDetails } from "../../../hooks/useCardDetails.ts";
import { useSetPrintings } from "../../../hooks/useSetPrintings.ts";
import { useSets } from "../../../hooks/useSets.ts";
import { useNavigation } from "../../../app/NavigationProvider.tsx";
import { useLibrary } from "../../../app/LibraryProvider.tsx";
import { Card, CardArt, Chip, Money, Panel, Row, ScreenReaderOnly, Stack } from "../../primitives/index.ts";
import { printingsOf } from "./printings.ts";
import styles from "./CardDetailsScreen.module.css";

/**
 * Everything about one printing — and the place you mark it.
 *
 * ## Every printing, each markable on its own
 *
 * A card is not one thing. Base Charizard exists as a holo and a 1st Edition
 * holo; a modern common exists as normal, reverse, and however many ball
 * patterns that set invented. Owning one is not owning the others, so each gets
 * its own row, its own price, and its own toggle.
 *
 * The glasses' **collect-mode toggle and printing picker are dropped on
 * purpose**. They exist because a pinch is a single undifferentiated gesture
 * that has to be told which printing it means, so the device carries a modal
 * selection around with it. A finger points at the row it wants and never asks
 * that question, so carrying the mode over would be inventing a problem in
 * order to keep its solution.
 *
 * ## A missing price says so
 *
 * Every row shows a market price or the words `n/a`. A blank where a price
 * belongs reads as loading, forever — and `$0.00` reads as free, which is a
 * different card from an unpriced one. Both come from `Money`, which cannot
 * render either.
 *
 * ## Marking is shared state
 *
 * `useLibrary` is mounted once above both versions of the app, so a printing
 * marked here is marked on the set screen with no reload and no refetch — same
 * provider, same `collection` array, one re-render.
 */

interface CardDetailsScreenProps {
  cardId: string;
  /**
   * The row that was tapped, when there was one. Not a cache: it is what lets
   * the header paint immediately, and what keeps the screen able to name its
   * card when the catalog refuses to answer.
   */
  summary?: PokemonCardSummary;
}

export function CardDetailsScreen({ cardId, summary }: CardDetailsScreenProps) {
  const { openResults } = useNavigation();
  const { isFavorite, toggleFavorite, ownedFinishes, toggleOwned, addRecentlyViewed } = useLibrary();

  const details = useCardDetails(cardId);
  /** Freshly fetched wins; the summary keeps the screen usable when it does not arrive. */
  const card = details.data ?? summary;

  const setId = setIdFromCardId(cardId);
  const setName = card?.setName ?? "";
  const collectorNumber = card?.collectorNumber ?? "";

  /*
   * Printings are matched to TCGdex by normalised set NAME, not by id — me5
   * there is me05 — so this cannot run until the card has arrived.
   */
  const printings = useSetPrintings(setId, setName, Boolean(setName));

  /*
   * The printed denominator ("223/197") needs the set's own record. This is the
   * same query key the set and collection screens use, held 24h in memory and 7
   * days on disk, so it is one shared request for the whole app rather than one
   * per card viewed.
   */
  const sets = useSets();
  const set = useMemo(() => sets.data?.find((s) => s.id === setId), [sets.data, setId]);

  const held = ownedFinishes(cardId);
  const favorited = isFavorite(cardId);

  const { finishes, source } = useMemo(
    () => printingsOf(printings.index, collectorNumber, card?.variants),
    [printings.index, collectorNumber, card?.variants],
  );

  /*
   * The second pricing oracle, built from the card already in hand so it costs
   * nothing. TCGdex prices per printing and covers the modern sets; it returns
   * an empty block for promos and older cards where pokemontcg.io has a price.
   * Neither source covers the collection alone.
   */
  const catalogIndex = useMemo(() => catalogPriceIndex(card ? [card] : []), [card]);
  const priceOf = (finish: Finish): number | undefined =>
    printingPrice(printings.index, collectorNumber, finish) ?? catalogPrice(catalogIndex, cardId, finish);

  // Recorded once per card, not once per render: `card` changes identity when
  // the fetch lands behind an already-painted summary.
  const recorded = useRef<string | null>(null);
  useEffect(() => {
    if (!card || recorded.current === cardId) return;
    recorded.current = cardId;
    addRecentlyViewed(card);
  }, [cardId, card, addRecentlyViewed]);

  if (!card) {
    return details.isError ? (
      <Panel title="That card could not be loaded" headingLevel={2} tone="raised">
        <Stack gap={3}>
          <p className={styles.prose}>
            The catalog did not answer for <code>{cardId}</code>. It fails in bursts rather than staying down,
            so trying again usually works.
          </p>
          <Row gap={2}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => void details.refetch()}
              disabled={details.isFetching}
            >
              {details.isFetching ? "Trying again…" : "Try again"}
            </button>
          </Row>
        </Stack>
      </Panel>
    ) : (
      <LoadingCard />
    );
  }

  const heldHere = finishes.filter((f) => held.includes(f)).length;

  return (
    <Stack gap={5}>
      <Row gap={5} align="start" wrap>
        <div className={styles.hero}>
          <CardArt src={card.imageLarge ?? card.imageSmall} name={card.name} detail="hero" eager />
        </div>

        <Stack gap={4} className={styles.facts}>
          <Stack gap={1}>
            <h1 className={styles.title}>{card.name}</h1>
            <p className={styles.subtitle}>
              {card.setName} ·{" "}
              <span className={styles.number}>
                {formatCollector(
                  card.collectorNumber,
                  set?.printedTotal ? String(set.printedTotal) : undefined,
                )}
              </span>
            </p>
          </Stack>

          <Row gap={2} wrap>
            {card.rarity ? <Chip>{card.rarity}</Chip> : null}
            {card.setCode ? <Chip>{card.setCode}</Chip> : null}
            {details.data?.subtypes?.length ? <Chip>{details.data.subtypes.join(" · ")}</Chip> : null}
          </Row>

          <dl className={styles.meta}>
            {details.data?.artist ? <Fact term="Artist" value={details.data.artist} /> : null}
            {details.data?.releaseDate ? <Fact term="Released" value={details.data.releaseDate} /> : null}
            {set?.total ? <Fact term="Cards in set" value={String(set.total)} /> : null}
          </dl>

          <Row gap={2} wrap>
            <Chip onPress={() => toggleFavorite(card)} pressed={favorited}>
              {favorited ? "★ Favourite" : "☆ Favourite"}
            </Chip>
            <Chip onPress={() => openResults(card.name)}>More cards named {card.name}</Chip>
          </Row>
        </Stack>
      </Row>

      <Panel
        title="Printings"
        headingLevel={2}
        aside={
          finishes.length > 0 ? (
            <span className={styles.count}>
              {heldHere} of {finishes.length} held
            </span>
          ) : null
        }
      >
        <Stack gap={3}>
          {printings.isError ? (
            <PrintingsFailure
              retrying={printings.isFetching}
              onRetry={() => void printings.refetch()}
              haveFallback={finishes.length > 0}
            />
          ) : null}

          {printings.isLoading && finishes.length === 0 ? (
            <LoadingPrintings />
          ) : finishes.length === 0 ? (
            <p className={styles.prose}>
              Nothing vouches for this card&rsquo;s printings yet. Rather than offering a guess to mark —
              which is how <code>normal</code> once got written onto holo-only cards — this list stays empty
              until the printing data arrives.
            </p>
          ) : (
            <>
              {source === "pricing" ? (
                <p className={styles.note}>
                  From pricing data only. That never reports pattern foils — Poké Ball, Master Ball, energy —
                  so a patterned reverse this card has may be missing from the list.
                </p>
              ) : null}
              <Stack gap={2}>
                {finishes.map((finish) => (
                  <PrintingRow
                    key={finish}
                    finish={finish}
                    owned={held.includes(finish)}
                    price={priceOf(finish)}
                    pricePending={printings.isLoading}
                    onToggle={() => toggleOwned(cardId, finish, setId, card.collectorNumber)}
                  />
                ))}
              </Stack>
            </>
          )}
        </Stack>
      </Panel>
    </Stack>
  );
}

/* --- A printing ----------------------------------------------------------- */

function PrintingRow({
  finish,
  owned,
  price,
  pricePending,
  onToggle,
}: {
  finish: Finish;
  owned: boolean;
  price: number | undefined;
  pricePending: boolean;
  onToggle: () => void;
}) {
  return (
    <Card onPress={onToggle} selected={owned} className={styles.printing}>
      <span className={styles.printingName}>{finishLabel(finish)}</span>
      {/*
        The word, not only the colour. A selected row is tinted with the accent
        AND says "Owned" — colour on its own is exactly what deuteranopia loses,
        and `aria-pressed` alone is not visible to anyone reading the screen.
      */}
      <span className={owned ? styles.owned : styles.notOwned}>{owned ? "Owned" : "Not owned"}</span>
      <Money value={price} loading={pricePending} absentLabel="n/a" />
    </Card>
  );
}

/* --- Failure and waiting -------------------------------------------------- */

function PrintingsFailure({
  retrying,
  onRetry,
  haveFallback,
}: {
  retrying: boolean;
  onRetry: () => void;
  haveFallback: boolean;
}) {
  return (
    <div className={styles.failure}>
      <Stack gap={3}>
        <p className={styles.prose}>
          The printing list could not be reached. The catalog drops requests in bursts rather than staying
          down — nothing here is wrong with the card.
          {haveFallback ? " What is below came from pricing data and may be short a printing." : ""}
        </p>
        <Row gap={2}>
          <button type="button" className={styles.primary} onClick={onRetry} disabled={retrying}>
            {retrying ? "Trying again…" : "Try again"}
          </button>
        </Row>
      </Stack>
    </div>
  );
}

const PRINTING_SKELETON = [0, 1, 2];

function LoadingPrintings() {
  return (
    <div aria-busy="true" aria-live="polite">
      <ScreenReaderOnly>Loading printings</ScreenReaderOnly>
      <Stack gap={2}>
        {PRINTING_SKELETON.map((i) => (
          <div key={i} className={styles.skeletonRow} />
        ))}
      </Stack>
    </div>
  );
}

function LoadingCard() {
  return (
    <div aria-busy="true" aria-live="polite">
      <ScreenReaderOnly>Loading card</ScreenReaderOnly>
      <Row gap={5} align="start" wrap>
        <div className={styles.hero}>
          <div className={styles.skeletonArt} />
        </div>
        <Stack gap={3} className={styles.facts}>
          <div className={styles.skeletonTitle} />
          <div className={styles.skeletonRow} />
          <div className={styles.skeletonRow} />
        </Stack>
      </Row>
    </div>
  );
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div className={styles.fact}>
      <dt className={styles.factTerm}>{term}</dt>
      <dd className={styles.factValue}>{value}</dd>
    </div>
  );
}
