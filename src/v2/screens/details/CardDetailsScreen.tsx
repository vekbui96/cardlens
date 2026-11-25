import { useEffect, useMemo, useRef, useState, type TouchEvent } from "react";
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
import {
  Card,
  CardArt,
  Chip,
  ErrorNotice,
  failedOrRetrying,
  Money,
  Panel,
  Row,
  ScreenReaderOnly,
  Stack,
  UNPRICED,
} from "../../primitives/index.ts";
import { printingsOf } from "./printings.ts";
import {
  neighbours,
  readBrowseList,
  swipeStartsOnScroller,
  swipeStep,
  type BrowseEntry,
} from "./browseList.ts";
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
 * Every row shows a market price or the word `Unpriced`. A blank where a price
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

/**
 * ## Next and previous card
 *
 * A card opened from a list (Search results, Everything owned) can step to its
 * neighbours in that list, by button or by a horizontal swipe on touch. A step
 * REPLACES the history entry rather than pushing one, so Back goes straight to
 * the list it came from — where Search puts its scroll back — instead of
 * walking back through every card stepped past.
 *
 * The body is keyed by card id, so nothing from one card (the mark
 * confirmation, the recently-viewed guard) carries over to the next.
 */
export function CardDetailsScreen({ cardId, summary }: CardDetailsScreenProps) {
  const { replace } = useNavigation();
  const { list, around } = useMemo(() => {
    const remembered = readBrowseList();
    return { list: remembered, around: neighbours(remembered, cardId) };
  }, [cardId]);

  const step = (to: BrowseEntry | undefined) => {
    if (!to) return;
    if (window.scrollY > 0) window.scrollTo(0, 0);
    replace({ name: "details", cardId: to.cardId, ...(to.summary ? { summary: to.summary } : {}) });
  };

  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    const t = e.touches[0];
    const blocked = swipeStartsOnScroller(e.target, e.currentTarget);
    touch.current = e.touches.length === 1 && t && !blocked ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    const start = touch.current;
    touch.current = null;
    const t = e.changedTouches[0];
    if (!start || !t || !around) return;
    const dir = swipeStep(t.clientX - start.x, t.clientY - start.y);
    if (dir === 1) step(around.next);
    else if (dir === -1) step(around.previous);
  };

  if (!around || !list)
    return <CardDetailsBody key={cardId} cardId={cardId} {...(summary ? { summary } : {})} />;

  return (
    <div className={styles.browseHost} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <Stack gap={4}>
        <nav className={styles.browse} aria-label="Step through this list">
          <button
            type="button"
            className={styles.step}
            aria-label="Previous card"
            disabled={!around.previous}
            onClick={() => step(around.previous)}
          >
            Previous
          </button>
          <span className={styles.position}>
            {around.position} of {around.total} · {list.label}
          </span>
          <button
            type="button"
            className={styles.step}
            aria-label="Next card"
            disabled={!around.next}
            onClick={() => step(around.next)}
          >
            Next
          </button>
        </nav>
        <CardDetailsBody key={cardId} cardId={cardId} {...(summary ? { summary } : {})} />
      </Stack>
    </div>
  );
}

function CardDetailsBody({ cardId, summary }: CardDetailsScreenProps) {
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
  // Stays true through a retry, so the notice (and its focused button) is not
  // swapped for the skeleton mid-press. See `failedOrRetrying`.
  const printingsFailed = failedOrRetrying(printings);

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

  // The tab names the card (web only: v2 never runs on the glasses). MetricsBoot
  // sets the generic "Card" label first, being an earlier sibling, and this wins.
  const cardName = card?.name;
  useEffect(() => {
    if (cardName) document.title = `${cardName} · CardLens`;
  }, [cardName]);

  /*
   * The row flips at once (the library updates synchronously), and a short line
   * says what happened. A save that throws writes nothing, so the row is simply
   * left as it was and the notice says so.
   */
  const [markResult, setMarkResult] = useState<{
    kind: "marked" | "unmarked" | "failed";
    finish: Finish;
  } | null>(null);
  const mark = (finish: Finish) => {
    if (!card) return;
    const wasHeld = held.includes(finish);
    try {
      toggleOwned(cardId, finish, setId, card.collectorNumber);
      setMarkResult({ kind: wasHeld ? "unmarked" : "marked", finish });
    } catch {
      setMarkResult({ kind: "failed", finish });
    }
  };

  if (!card) {
    return failedOrRetrying(details) ? (
      <ErrorNotice
        title="That card could not be loaded"
        stillWorks="Your collection and recent cards are still available."
        busy={details.isFetching}
        onRetry={() => void details.refetch()}
      >
        The catalog did not answer for <code>{cardId}</code>. It fails in bursts rather than staying down, so
        trying again usually works.
      </ErrorNotice>
    ) : (
      <LoadingCard />
    );
  }

  const heldHere = finishes.filter((f) => held.includes(f)).length;
  // One headline price, and the printing it belongs to: a priced printing the
  // collector holds comes first, else the first priced one (list order).
  const pricedFinishes = finishes.filter((f) => priceOf(f) !== undefined);
  const headlineFinish = pricedFinishes.find((f) => held.includes(f)) ?? pricedFinishes[0];
  const headlinePrice = headlineFinish === undefined ? undefined : priceOf(headlineFinish);

  return (
    <Stack gap={5} className={styles.page}>
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

          <p className={styles.priceLine} data-testid="price-line">
            <span className={styles.priceLabel}>
              Market price{headlineFinish === undefined ? "" : ` · ${finishLabel(headlineFinish)}`}
            </span>
            <Money value={headlinePrice} loading={printings.isLoading} absentLabel={UNPRICED} />
          </p>

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

      <div className={styles.printings} data-testid="printings-section">
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
            {printingsFailed ? (
              <PrintingsFailure
                retrying={printings.isFetching}
                onRetry={() => void printings.refetch()}
                haveFallback={finishes.length > 0}
              />
            ) : null}

            {printings.isLoading && !printingsFailed && finishes.length === 0 ? (
              <LoadingPrintings />
            ) : finishes.length === 0 ? (
              <p className={styles.prose}>
                Nothing vouches for this card&rsquo;s printings yet. Rather than offering a guess to mark —
                which is how <code>normal</code> once got written onto holo-only cards — this list stays empty
                until the printing data arrives.
              </p>
            ) : (
              <>
                <p className={styles.confirm} role="status" data-testid="mark-confirmation">
                  {markResult && markResult.kind !== "failed" ? (
                    <>
                      <svg
                        viewBox="0 0 24 24"
                        width="20"
                        height="20"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        aria-hidden="true"
                      >
                        <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" />
                      </svg>
                      {`${markResult.kind === "marked" ? "Marked as owned" : "Unmarked"}: ${finishLabel(markResult.finish)}.`}
                    </>
                  ) : null}
                </p>
                {source === "pricing" ? (
                  <p className={styles.note}>
                    From pricing data only. That never reports pattern foils — Poké Ball, Master Ball, energy
                    — so a patterned reverse this card has may be missing from the list.
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
                      onToggle={() => mark(finish)}
                    />
                  ))}
                </Stack>
                {markResult?.kind === "failed" ? (
                  <ErrorNotice
                    stillWorks="Nothing was changed: the printing is still as it was."
                    onRetry={() => mark(markResult.finish)}
                  >
                    {finishLabel(markResult.finish)} could not be saved on this device.
                  </ErrorNotice>
                ) : null}
              </>
            )}
          </Stack>
        </Panel>
      </div>
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
      <Money value={price} loading={pricePending} absentLabel={UNPRICED} />
      {/* Decorative: the row is the button and its name already says Owned / Not owned. */}
      <span
        className={owned ? styles.affordanceOwned : styles.affordance}
        data-affordance="printing-affordance"
        data-owned={owned ? "true" : "false"}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d={owned ? "M5 12.5l4.5 4.5L19 7.5" : "M12 5v14M5 12h14"} strokeLinecap="round" />
        </svg>
      </span>
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
    <ErrorNotice
      stillWorks={
        haveFallback ? "What is below came from pricing data and may be short a printing." : undefined
      }
      busy={retrying}
      onRetry={onRetry}
    >
      The printing list could not be reached. The catalog drops requests in bursts rather than staying down —
      nothing here is wrong with the card.
    </ErrorNotice>
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
