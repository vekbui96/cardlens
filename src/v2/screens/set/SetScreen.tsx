import { useMemo, useState } from "react";
import { useLibrary } from "../../../app/LibraryProvider.tsx";
import { screenToPath } from "../../../app/screenUrl.ts";
import { ownedIn, tierLabel } from "../../../features/collection/completionTier.ts";
import { RARITY_FILTERS, filterByRarity } from "../../../features/results/rarityFilters.ts";
import { useSets } from "../../../hooks/useSets.ts";
import { useSetView } from "../../../hooks/useSetView.ts";
import { setTiers } from "../../../models/setCompletion.ts";
import type { BinderPage } from "../../../models/binder.ts";
import { Card, Chip, Grid, Meter, Panel, Row, ScreenReaderOnly, Stack, cx } from "../../primitives/index.ts";
import { SetPocket } from "./SetPocket.tsx";
import { SetSwitcher } from "./SetSwitcher.tsx";
import {
  board,
  buildPockets,
  completionFigure,
  filterSummary,
  pricingCoverage,
  visiblePockets,
  type Filters,
  type Pocket,
} from "./setBoard.ts";
import styles from "./Set.module.css";

/**
 * A set as nine-pocket binder pages, one pocket per printing.
 *
 * The glasses render the same set as a focus-ring list of text rows, because
 * four gestures and a 600x600 additive display leave room for nothing else. A
 * browser has a finger or a pointer, a scrollbar and a real screen, and
 * collectors recognise cards by art long before they read a collector number —
 * so here the art IS the interface, and marking is a tap on the printing rather
 * than a mode you enter.
 *
 * ## The request budget
 *
 * ONE request for the set's printings, whatever you do on this screen. That is
 * the measured cost: building a set's printings upstream is 120–295 requests, so
 * `useSetView` reads them from our own server's disk cache in one go, and the
 * per-card path exists only as a fallback.
 *
 * The rarity filter therefore runs IN MEMORY, and this is the one place the
 * screen deliberately departs from v1. v1 hands `rarities` to `useSetView`,
 * which on the fallback path becomes a fresh `set-cards` query per rarity —
 * five filters, five round trips, for a list already sitting in the browser.
 * `filterByRarity` is the same predicate the API applies, so nothing changes
 * except the number of requests, which goes to zero.
 *
 * ## Why there is no back button
 *
 * The shell's nav is on this screen, with Collection marked current. A second
 * way back, drawn by the screen, is a control that goes stale the moment the
 * shell's navigation changes — and the switcher below is the answer to the thing
 * people actually used Back for, which was reaching a different set.
 */
export function SetScreen({ setId, setName }: { setId: string; setName: string }) {
  const {
    ownedFinishes,
    excludedFinishes,
    toggleOwned,
    ownedCountsBySet,
    ownedFinishCountsBySet,
    ownedNumbersBySet,
    storageDegraded,
  } = useLibrary();
  const { data: sets } = useSets();
  const set = sets?.find((s) => s.id === setId);

  const [rarityKey, setRarityKey] = useState("all");
  const [missingOnly, setMissingOnly] = useState(false);

  const rarity = RARITY_FILTERS.find((f) => f.key === rarityKey) ?? RARITY_FILTERS[0];

  /*
   * Printings up front. There is no collect mode to gate them behind here, and
   * every pocket on the screen is one — a set with 120 cards issues one request
   * for all of them, not 120.
   */
  const view = useSetView(setId, setName, { wantPrintings: true });

  const filters: Filters = { rarities: rarity.rarities, missingOnly };

  /**
   * Everything, in collector order, before any filter — so the pricing figures
   * describe the SET rather than the current view. A coverage line that changed
   * when you pressed a rarity chip would be measuring the filter, not the data.
   */
  const allPockets = useMemo(
    () =>
      buildPockets(view.cards, {
        finishesFor: view.finishesFor,
        heldFor: ownedFinishes,
        excludedFor: excludedFinishes,
        priceFor: view.priceFor,
      }),
    [view.cards, view.finishesFor, view.priceFor, ownedFinishes, excludedFinishes],
  );

  const shown = useMemo(() => {
    /*
     * Rarity narrows CARDS; "missing only" narrows POCKETS. Doing them in that
     * order matters: a card kept for its rarity still shows every printing of
     * itself, which is the whole point of a per-printing screen.
     */
    const scoped =
      rarity.rarities === null
        ? allPockets
        : (() => {
            const keep = new Set(filterByRarity(view.cards, rarity.rarities).map((c) => c.id));
            return allPockets.filter((p) => keep.has(p.card.id));
          })();
    return visiblePockets(scoped, { rarities: rarity.rarities, missingOnly });
  }, [allPockets, view.cards, rarity.rarities, missingOnly]);

  const laidOut = board(shown, filters);
  const summary = filterSummary(filters, rarity.rarities === null ? null : rarity.label, shown.length);

  const priced = useMemo(() => allPockets.filter((p) => p.price !== undefined).length, [allPockets]);
  const coverage = pricingCoverage(allPockets.length, priced);

  const ownedCards = ownedCountsBySet[setId] ?? 0;
  const ownedPrintings = ownedFinishCountsBySet[setId] ?? 0;
  const tiers = setTiers(
    {
      ...(set?.total ? { total: set.total } : {}),
      ...(set?.printedTotal ? { printedTotal: set.printedTotal } : {}),
    },
    ownedIn(setId, ownedNumbersBySet, ownedCards),
  );
  const figure = completionFigure(tiers, ownedCards);
  const word = tierLabel(tiers.tier);

  const mark = (pocket: Pocket) => toggleOwned(pocket.card.id, pocket.finish, setId, pocket.collectorNumber);

  return (
    <Stack gap={5}>
      <header>
        <Stack gap={3}>
          <Row gap={3} align="center" justify="space-between" wrap>
            <h1 className={styles.title}>{setName}</h1>
            <SetSwitcher setId={setId} setName={setName} />
          </Row>

          <div className={styles.progress}>
            <Meter
              value={figure.ratio}
              label={`${setName} completion`}
              detail={
                <>
                  {/* ★ and the uppercase word carry the milestone where colour
                      cannot — base green against master gold is exactly the pair
                      deuteranopia collapses. */}
                  {tiers.tier !== "none" ? "★ " : ""}
                  {figure.text}
                  {word ? (
                    <span
                      className={cx(
                        styles.tierWord,
                        tiers.tier === "master" ? styles.tierMaster : styles.tierBase,
                      )}
                    >
                      {" "}
                      {word}
                    </span>
                  ) : null}
                  {` · ${ownedPrintings} ${ownedPrintings === 1 ? "printing" : "printings"} held`}
                </>
              }
            />
          </div>

          {/*
            Prices, with their denominator. A column of grey "Unavailable" is
            what a set of worthless cards looks like AND what a set the providers
            have never priced looks like; this sentence is the only thing that
            tells them apart.
          */}
          <p className={cx(styles.line, coverage.warn && styles.lineWarn)}>{coverage.line}</p>
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
        <Chip
          onPress={() => setMissingOnly((on) => !on)}
          pressed={missingOnly}
          tone={missingOnly ? "accent" : "default"}
        >
          Missing only
        </Chip>
      </Row>

      {view.isLoading ? <PageSkeleton /> : null}

      {view.isError ? (
        <Panel title="Couldn’t load this set" headingLevel={2} tone="raised" className={styles.warnPanel}>
          <Stack gap={3}>
            <p className={styles.note}>
              The catalog did not answer for {setName}. Everything you have already marked in this set is safe
              on this device — only the card list is missing.
            </p>
            <Row>
              <Chip onPress={view.refetch}>Try again</Chip>
            </Row>
          </Stack>
        </Panel>
      ) : null}

      {!view.isLoading && !view.isError && view.cards.length === 0 ? (
        <Panel title="No cards for this set" headingLevel={2}>
          <Stack gap={3}>
            <p className={styles.note}>
              The catalog has nothing indexed for {setName}. Anything you mark elsewhere still counts toward
              it.
            </p>
            <Row>
              <Card href={`#${screenToPath({ name: "sets" })}`}>Browse all sets</Card>
            </Row>
          </Stack>
        </Panel>
      ) : null}

      {summary?.empty ? (
        <Panel title={summary.title} headingLevel={2}>
          <p className={styles.note}>{summary.hint}</p>
        </Panel>
      ) : null}

      {/*
        A filtered view is not a binder page, and it says so by looking nothing
        like one: no page markers, no fixed three-across sheet, just a count and
        a grid that reflows to the window. Drawing "Page 3" over a rarity-filtered
        run would name a physical sheet that does not exist.
      */}
      {summary && !summary.empty ? <h2 className={styles.flatHeading}>{summary.title}</h2> : null}

      {laidOut.kind === "grid" && laidOut.pockets.length > 0 ? (
        <Grid as="ul" min="pocket" gap={3} className={styles.flat}>
          {laidOut.pockets.map((pocket) => (
            <li key={pocket.key}>
              <SetPocket pocket={pocket} onToggle={() => mark(pocket)} />
            </li>
          ))}
        </Grid>
      ) : null}

      {laidOut.kind === "pages" && laidOut.pages.length > 0 ? (
        <div className={styles.pages}>
          {laidOut.pages.map((page) => (
            <Page key={page.index} page={page} onMark={mark} />
          ))}
        </div>
      ) : null}
    </Stack>
  );
}

/**
 * One physical sheet.
 *
 * The marker names the run it covers and how much of it is done, because a page
 * is the unit a collector actually works in — "page 4 needs three more" is a
 * sentence people say. Full is gold AND says "complete" in words: gold against
 * the green of a part-filled bar is exactly the pair deuteranopia collapses.
 */
function Page({ page, onMark }: { page: BinderPage<Pocket>; onMark: (pocket: Pocket) => void }) {
  return (
    <section className={styles.page}>
      <Panel
        tone="quiet"
        headingLevel={2}
        title={`Page ${page.index}`}
        aside={
          <Row gap={2} align="baseline">
            <span className={styles.pageRange}>
              {page.from}–{page.to}
            </span>
            {page.full ? (
              <Chip tone="gold">Complete</Chip>
            ) : (
              <span className={styles.pageCount}>
                {page.complete}/{page.cards.length}
              </span>
            )}
          </Row>
        }
      >
        <ul className={styles.pockets}>
          {page.cards.map((pocket) => (
            <li key={pocket.key}>
              <SetPocket pocket={pocket} onToggle={() => onMark(pocket)} />
            </li>
          ))}
        </ul>
      </Panel>
    </section>
  );
}

/**
 * The shape of the content, in collector order.
 *
 * Two pages of nine, because that is what arrives — a spinner says "something is
 * happening", this says what is about to be there, and nothing jumps when it
 * lands.
 */
function PageSkeleton() {
  return (
    <div className={styles.pages} aria-busy="true" aria-live="polite">
      <ScreenReaderOnly>Loading this set</ScreenReaderOnly>
      {[1, 2].map((index) => (
        <div key={index} className={styles.page}>
          <span className={styles.skeletonMarker} />
          <ul className={styles.pockets}>
            {Array.from({ length: 9 }, (_, i) => (
              <li key={i}>
                <span className={styles.skeletonPocket} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
