import { useEffect, useMemo } from "react";
import { useLibrary } from "../../../app/LibraryProvider.tsx";
import { screenToPath } from "../../../app/screenUrl.ts";
import { useCardDetails } from "../../../hooks/useCardDetails.ts";
import { useSetPrintings } from "../../../hooks/useSetPrintings.ts";
import { useSets } from "../../../hooks/useSets.ts";
import { availableFinishes, type PokemonCardSummary } from "../../../models/cards.ts";
import type { Finish } from "../../../models/finishes.ts";
import { printingPrice } from "../../../models/printingIndex.ts";
import { setIdFromCardId } from "../../../utils/cardId.ts";
import { Card, CardArt, Chip, Panel, Row, ScreenReaderOnly, Stack, cx } from "../../primitives/index.ts";
import { PrintingRow } from "./PrintingRow.tsx";
import {
  cardPrintings,
  collectorLine,
  factRows,
  pricingCoverage,
  variantPrice,
  type CardFacts,
  type Printing,
} from "./cardFacts.ts";
import styles from "./Details.module.css";

/**
 * Everything about one printing, and mark it from here.
 *
 * ## Why this screen owns the exclusion control
 *
 * TCGdex lists every printing that has ever existed, so a master set contains
 * box toppers, staff promos and league prizes that nobody is chasing — and until
 * one of them can be excluded, the completion figure has an unreachable
 * denominator and the set never finishes. v1 put that control in the set
 * screen's card sheet. v2's set screen deliberately has no sheet: the pocket IS
 * the control, one tap, one printing. That left the whole of v2 with nowhere to
 * set or clear an exclusion — the set grid draws excluded printings (dashed,
 * chipped) and could not produce one.
 *
 * Card details is the right home for it and not merely the only one left. It is
 * the single place in the app that shows every printing of a card at once, side
 * by side, with what each is worth — which is exactly the comparison "is this
 * one part of my set?" needs. On the set grid the same control would have to be
 * a second button inside a pocket, which is where v1's sheet came from.
 *
 * ## The request budget
 *
 * TWO requests per card, and one of them is usually already in flight for
 * something else:
 *
 * - `useCardDetails` — one `getCard`, cached-first for an hour, and skipped
 *   entirely on a warm cache. It is what supplies artist, subtypes and release
 *   date; the `summary` handed over by whatever opened this screen paints the
 *   header instantly while it runs.
 * - `useSetPrintings` — ONE request for the whole set's printings, from our own
 *   server's disk cache. Building them upstream costs 120–295 requests, which
 *   is why nothing here may fan out per printing. It also carries the per-
 *   printing prices, so this screen does NOT call `getPrices`: `variantPrice`
 *   falls back to the numbers already riding on the summary, which is a third
 *   request avoided rather than a price invented.
 *
 * `useSets` is the app-wide set list, cached in localStorage for seven days and
 * shared with Home, Collection and the set screen. It is here for one thing —
 * the printed denominator, so the number reads "223/197" as it does on the card
 * itself — and it costs nothing on any journey that has passed through one of
 * those screens. A cold, pasted card link pays one shared request for it, and
 * the line falls back to the bare collector number until it lands.
 */
export function DetailsScreen({ cardId, summary }: { cardId: string; summary?: PokemonCardSummary }) {
  const { ownedFinishes, excludedFinishes, toggleOwned, toggleExcluded, addRecentlyViewed, storageDegraded } =
    useLibrary();

  const details = useCardDetails(cardId);
  /*
   * Whatever has arrived, preferring the fuller answer. The summary is not a
   * placeholder to be replaced — it is the same card, with fewer fields, and
   * drawing it immediately is the difference between a header and a skeleton.
   */
  const card: CardFacts | undefined = details.data ?? summary;

  const setId = setIdFromCardId(cardId);
  const { data: sets } = useSets();
  const set = sets?.find((s) => s.id === setId);

  /*
   * The set name rides along because printings are matched to TCGdex by
   * normalised NAME, not by id — `me5` there is `me05`. Until a name is known
   * the query stays switched off rather than firing one that cannot match.
   */
  const setName = card?.setName ?? set?.name ?? "";
  const printings = useSetPrintings(setId, setName, Boolean(setName));

  useEffect(() => {
    if (card) addRecentlyViewed(card);
    // Once per card viewed, not once per field that arrives: `card` is a fresh
    // object on every render and would otherwise rewrite the trail continuously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, Boolean(card)]);

  const held = ownedFinishes(cardId);
  const skipped = excludedFinishes(cardId);
  const index = printings.index;

  const rows = useMemo<Printing[]>(() => {
    if (!card) return [];
    const real = index?.byNumber[card.collectorNumber];
    return cardPrintings({
      /*
       * Real TCGdex printings first, then what the pricing payload implies.
       * The second is a weak signal — it reports nothing at all for some sets
       * and never reports pattern foils — but it is the difference between a
       * markable card and a dead page while the index is unavailable.
       */
      available: real && real.length > 0 ? real : availableFinishes(card.variants),
      held,
      excluded: skipped,
      priceFor: (finish: Finish) =>
        printingPrice(index, card.collectorNumber, finish) ?? variantPrice(finish, card.variantPrices),
    });
  }, [card, index, held, skipped]);

  const priced = rows.filter((r) => r.price !== undefined).length;
  const coverage = pricingCoverage(rows.length, priced);
  /* No price yet is a "not yet" only while the index is genuinely on the wire. */
  const pricesLoading = printings.isLoading && index === null;

  if (!card) {
    return details.isError ? (
      <NotFound cardId={cardId} onRetry={() => void details.refetch()} />
    ) : (
      <Waiting />
    );
  }

  const facts = factRows(card, set);

  return (
    <Stack gap={5}>
      <header>
        <Stack gap={2}>
          <h1 className={styles.title}>{card.name}</h1>
          {/*
            Set, printed number and rarity, in the words on the card itself.
            "223/197" rather than "223": the denominator is what a collector
            says out loud, and it is the difference between a secret rare and
            an ordinary one at a glance.
          */}
          <p className={styles.subtitle}>
            {set?.name ?? card.setName} · {collectorLine(card.collectorNumber, set?.printedTotal)}
            {card.rarity ? ` · ${card.rarity}` : ""}
          </p>
        </Stack>
      </header>

      {/*
        Shown where the marking happens, because that is the action it qualifies.
        Silence here is what made a full device look like an app ignoring taps.
      */}
      {storageDegraded ? (
        <Panel
          title="This device is out of storage"
          headingLevel={2}
          tone="raised"
          className={styles.warnPanel}
        >
          <p className={styles.note}>
            Marks are kept in memory and still sync, but reload before they do and the newest ones are lost.
          </p>
        </Panel>
      ) : null}

      <div className={styles.top}>
        <div className={styles.artColumn}>
          {/*
            Large, and decorative. The `<h1>` immediately above already names the
            card, so alt text here would announce the same words twice — and the
            artwork itself is not something alt text can carry. `hero` asks the
            CDN for the big image, which is not the same thing as a size on the
            page: the column decides that.
          */}
          <CardArt src={card.imageLarge ?? card.imageSmall} name={card.name} detail="hero" decorative eager />
        </div>

        <div className={styles.factsColumn}>
          <Stack gap={4}>
            <Panel title="This card" headingLevel={2} tone="quiet">
              <dl className={styles.facts}>
                {facts.map((fact) => (
                  /* `display: contents` on the pair, so the two-column grid on
                     the `<dl>` lays out the `<dt>`/`<dd>` themselves while the
                     wrapper keeps them associated in the markup. */
                  <div key={fact.term} className={styles.factPair}>
                    <dt className={styles.factTerm}>{fact.term}</dt>
                    <dd className={styles.factValue}>{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </Panel>

            <Panel
              title="Printings"
              headingLevel={2}
              aside={
                <span className={cx(styles.coverage, coverage.warn && styles.coverageWarn)}>
                  {coverage.line}
                </span>
              }
            >
              <Stack gap={3}>
                <ul className={styles.printings}>
                  {rows.map((printing) => (
                    <PrintingRow
                      key={printing.key}
                      printing={printing}
                      pricesLoading={pricesLoading}
                      /*
                       * The set id AND the collector number go with the mark.
                       * Without the number the row cannot be classified as base
                       * or secret, and `setTiers` declines the base tier for the
                       * whole set — a mark made here would count for less than
                       * the identical mark made on the set screen.
                       */
                      onToggle={() => toggleOwned(cardId, printing.finish, setId, card.collectorNumber)}
                      onToggleExcluded={() => toggleExcluded(cardId, printing.finish, setId)}
                    />
                  ))}
                </ul>

                {/*
                  Says what "not in this set" is for, once, under the rows that
                  use it. Without it the Exclude buttons read as a way to delete
                  a printing rather than to take it out of a target.
                */}
                <p className={styles.note}>
                  The catalog lists every printing ever made, promos and box toppers included. Excluding one
                  takes it out of this set’s target without pretending it does not exist.
                </p>

                {printings.isError ? <PricesUnreachable onRetry={() => void printings.refetch()} /> : null}
              </Stack>
            </Panel>

            <Stack gap={2}>
              {/*
                Other printings OF THIS POKÉMON, which is a different question
                from the printings of this card above — it is how you get from
                the Base Set Charizard to the other 107. A real link, because it
                is a real search URL.
              */}
              <Card href={`#${screenToPath({ name: "results", query: card.name })}`} pad={3}>
                Every {card.name} card
              </Card>
              {/* Only once the set has a name: `/set/:id/:name` with an empty
                  name parses back to nothing and resolves to Home. */}
              {setName ? (
                <Card href={`#${screenToPath({ name: "set", setId, setName })}`} pad={3}>
                  Open {setName}
                </Card>
              ) : null}
            </Stack>
          </Stack>
        </div>
      </div>
    </Stack>
  );
}

/* --- States --------------------------------------------------------------- */

/**
 * Prices, and only prices, could not be reached.
 *
 * Everything else on this screen still works: the card is drawn, and marking is
 * local-first so it lands on the device whatever the network is doing. Saying
 * so is the difference between a screen that is degraded and one that looks
 * broken — and the retry is offered because our own server being briefly
 * unreachable is the most likely cause and the cheapest to recover from.
 */
function PricesUnreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <Panel title="Prices couldn’t be reached" headingLevel={3} tone="raised" className={styles.warnPanel}>
      <Stack gap={3}>
        <p className={styles.note}>
          The printings for this set did not answer, so some rows have no price. Marking still works and is
          saved on this device.
        </p>
        <Row>
          <Chip onPress={onRetry}>Try again</Chip>
        </Row>
      </Stack>
    </Panel>
  );
}

/**
 * The card itself could not be fetched and nothing was handed over.
 *
 * Reached by a pasted or bookmarked link to a card the catalog cannot answer
 * for — which includes every card in the collection whose set the catalog has
 * never indexed. It offers the two ways out rather than being a dead end.
 */
function NotFound({ cardId, onRetry }: { cardId: string; onRetry: () => void }) {
  return (
    <Panel title="Couldn’t load this card" headingLevel={2} tone="raised" className={styles.warnPanel}>
      <Stack gap={3}>
        <p className={styles.note}>
          The catalog did not answer for <code>{cardId}</code>. Nothing you have marked is affected — only
          this card’s details are missing.
        </p>
        <Row>
          <Chip onPress={onRetry}>Try again</Chip>
        </Row>
        <Card href={`#${screenToPath({ name: "results", query: "" })}`} pad={3}>
          Search for it instead
        </Card>
      </Stack>
    </Panel>
  );
}

/**
 * The shape of the content: one large card and a column of lines beside it.
 *
 * Only ever seen on a cold link — anything that navigates here from inside the
 * app hands over a summary and paints the header immediately.
 */
function Waiting() {
  return (
    <div className={styles.top} aria-busy="true" aria-live="polite">
      <ScreenReaderOnly>Loading this card</ScreenReaderOnly>
      <div className={styles.artColumn}>
        <span className={styles.skeletonArt} />
      </div>
      <div className={styles.factsColumn}>
        <Stack gap={3}>
          <span className={cx(styles.skeletonLine, styles.skeletonLineShort)} />
          <span className={styles.skeletonLine} />
          <span className={styles.skeletonLine} />
          <span className={styles.skeletonLine} />
        </Stack>
      </div>
    </div>
  );
}
