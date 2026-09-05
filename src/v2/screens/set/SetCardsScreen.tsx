import { useCallback, useMemo, useState } from "react";
import { Chip, Grid, Meter, Panel, Row, ScreenReaderOnly, Stack, cx } from "../../primitives/index.ts";
import { useLibrary } from "../../../app/LibraryProvider.tsx";
import { useSetView } from "../../../hooks/useSetView.ts";
import { RARITY_FILTERS } from "../../../features/results/rarityFilters.ts";
import { BINDER_PAGE_SIZE } from "../../../models/binder.ts";
import { SetPocket } from "./SetPocket.tsx";
import { SetSwitcher } from "./SetSwitcher.tsx";
import {
  buildSlots,
  isBinderOrder,
  NO_FILTERS,
  pagesFor,
  pricedCount,
  visibleSlots,
  type FilterState,
  type PrintingSlot,
} from "./slots.ts";
import styles from "./set.module.css";

/**
 * A set as nine-pocket binder pages, one pocket per printing.
 *
 * This is the screen a master-set collector spends real time in, so two things
 * decide its shape. First, marking is per PRINTING: a card with a normal, a
 * reverse and a holo is three pockets and three targets, because that is three
 * pockets in the binder. Second, the nine-pocket rhythm is the hobby's — a set
 * is worked through in collector-number order out of physical sheets — and a
 * page drawn over a FILTERED run would name something that does not exist, so a
 * filter falls back to a flat grid (see `isBinderOrder`).
 *
 * Everything it needs comes from ONE request. `useSetView(..., {
 * wantPrintings: true })` pulls the set's printings from TCGdex through the
 * server's disk cache — about 8KB for a whole set — where asking upstream
 * per card costs 120-295 requests. That budget is asserted in
 * `e2e/v2/set-cards.spec.ts` rather than trusted, because it is the kind of
 * regression that shows up only as "the set screen got slow".
 */
export function SetCardsScreen({ setId, setName }: { setId: string; setName: string }) {
  const {
    ownedFinishes,
    excludedFinishes,
    toggleOwned,
    ownedFinishCountsBySet,
    storageDegraded,
    syncStatus,
  } = useLibrary();

  /**
   * Filters deliberately survive a set switch. "Missing only" is a question you
   * ask of set after set, and re-checking it on every switch is the friction the
   * switcher exists to remove.
   */
  const [filters, setFilters] = useState<FilterState>(NO_FILTERS);
  const rarity = RARITY_FILTERS.find((f) => f.key === filters.rarityKey) ?? RARITY_FILTERS[0];

  // Printings are wanted up front: there is no collect mode to gate them behind
  // on the web, and every pocket on screen is one.
  const view = useSetView(setId, setName, { rarities: rarity.rarities, wantPrintings: true });

  const { cards, finishesFor, priceFor } = view;

  const slots = useMemo(
    () => buildSlots(cards, { finishesFor, ownedFinishes, excludedFinishes }),
    [cards, finishesFor, ownedFinishes, excludedFinishes],
  );
  const visible = useMemo(() => visibleSlots(slots, filters), [slots, filters]);
  const pages = useMemo(() => pagesFor(visible, filters), [visible, filters]);
  const excludedCount = useMemo(() => slots.filter((s) => s.excluded).length, [slots]);
  const priced = useMemo(() => pricedCount(visible, priceFor), [visible, priceFor]);

  const toggle = useCallback(
    (slot: PrintingSlot) =>
      // The collector number rides along so the base/master split stays
      // answerable away from this screen — `ownedNumbersBySet` omits a card
      // whose number it never learned rather than guessing one.
      toggleOwned(slot.card.id, slot.finish, setId, slot.collectorNumber),
    [toggleOwned, setId],
  );

  const pocket = (slot: PrintingSlot, index: number) => (
    <SetPocket
      key={slot.key}
      slot={slot}
      price={priceFor(slot.collectorNumber, slot.finish)}
      onToggle={() => toggle(slot)}
      eager={index < BINDER_PAGE_SIZE}
    />
  );

  const ownedPrintings = ownedFinishCountsBySet[setId] ?? 0;
  const masterTotal = view.masterTotal;
  const binderOrder = isBinderOrder(filters);
  const settled = !view.isLoading && !view.isError;

  return (
    <Stack gap={5}>
      <Stack gap={3}>
        <SetSwitcher setId={setId} setName={setName} />

        {/*
         * The master-set figure, and it says which figure it is. This header
         * showed a bare unlabelled number in v1, so the same set read 197/408
         * here and 197/230 in the switcher directly beneath it, with nothing
         * saying why they differed.
         */}
        <Meter
          value={masterTotal ? ownedPrintings / masterTotal : Number.NaN}
          label={`${setName} printings held`}
          detail={
            masterTotal
              ? `${ownedPrintings} / ${masterTotal} printings${ownedPrintings >= masterTotal ? " · complete" : ""}`
              : `${ownedPrintings} printings held · total not known yet`
          }
        />

        <Notices
          printingsKnown={view.printings !== null}
          settled={settled}
          visibleCount={visible.length}
          priced={priced}
          storageDegraded={storageDegraded}
          offline={syncStatus.state === "offline"}
        />
      </Stack>

      <Stack gap={2}>
        {/*
         * A bare wrapper, because the layout primitives take no ARIA. The rarity
         * bar has to be one named group: five chips labelled "IR" and "SIR" with
         * nothing tying them together is five unexplained buttons to anyone not
         * looking at them.
         */}
        <div role="group" aria-label="Filter by rarity">
          <Row gap={2} wrap>
            {RARITY_FILTERS.map((f) => (
              <Chip
                key={f.key}
                onPress={() => setFilters((s) => ({ ...s, rarityKey: f.key }))}
                pressed={f.key === filters.rarityKey}
                tone={f.key === filters.rarityKey ? "accent" : "default"}
                label={f.label}
              >
                {f.short}
              </Chip>
            ))}
          </Row>
        </div>

        <Row gap={2} wrap>
          <Chip
            onPress={() => setFilters((s) => ({ ...s, missingOnly: !s.missingOnly }))}
            pressed={filters.missingOnly}
            tone={filters.missingOnly ? "accent" : "default"}
          >
            Missing only
          </Chip>
          {excludedCount > 0 ? (
            <Chip
              onPress={() => setFilters((s) => ({ ...s, showExcluded: !s.showExcluded }))}
              pressed={filters.showExcluded}
              tone={filters.showExcluded ? "accent" : "default"}
            >
              Excluded ({excludedCount})
            </Chip>
          ) : null}
        </Row>
      </Stack>

      {view.isLoading ? <PageSkeletons /> : null}

      {view.isError ? (
        <Panel title="The card catalog could not be reached" headingLevel={2} tone="raised">
          <Stack gap={3}>
            {/* Says what failed and offers the retry. It does not blame the
                user: the catalog fails in bursts, roughly a quarter of the
                time, and nothing they did caused it. */}
            <p className={styles.prose}>
              {setName} could not be loaded. Anything already marked is safe — the collection is held on this
              device.
            </p>
            <Row gap={2}>
              <Chip onPress={() => view.refetch()} tone="accent">
                Try again
              </Chip>
            </Row>
          </Stack>
        </Panel>
      ) : null}

      {settled && visible.length === 0 ? (
        <Panel
          title={filters.missingOnly ? "Nothing missing" : `No ${rarity.short} cards here`}
          headingLevel={2}
        >
          <Stack gap={3}>
            <p className={styles.prose}>
              {filters.missingOnly
                ? "Every printing that survived these filters is already held."
                : `${setName} has no cards at this rarity.`}
            </p>
            <Row gap={2}>
              <Chip onPress={() => setFilters(NO_FILTERS)} tone="accent">
                Clear filters
              </Chip>
            </Row>
          </Stack>
        </Panel>
      ) : null}

      {/* A filtered view is not a binder page — it says what it is instead. */}
      {settled && visible.length > 0 && !binderOrder ? (
        <Stack gap={3}>
          <p className={styles.summary} data-testid="filtered-count">
            {visible.length} {visible.length === 1 ? "printing" : "printings"} match these filters
          </p>
          <Grid min="pocket" gap={3} as="ul" className={styles.flatGrid}>
            {visible.map(pocket)}
          </Grid>
        </Stack>
      ) : null}

      {settled && visible.length > 0 && binderOrder ? (
        <div className={styles.pages} data-testid="binder-pages">
          {pages.map((page) => (
            <Panel
              key={page.index}
              title={`Page ${page.index}`}
              headingLevel={2}
              aside={
                <span className={cx(styles.pageCount, page.full && styles.pageCountFull)}>
                  {/* Gold means finished AND the word says so. */}
                  {page.full ? "★ complete · " : ""}
                  {page.complete}/{page.cards.length}
                  <span className={styles.pageRange}>
                    {" "}
                    · {page.from}–{page.to}
                  </span>
                </span>
              }
            >
              <ul className={styles.pocketGrid}>{page.cards.map(pocket)}</ul>
            </Panel>
          ))}
        </div>
      ) : null}
    </Stack>
  );
}

/**
 * The honest lines about what this screen can and cannot tell you.
 *
 * Each one exists because its silence was a bug: a set with no printing data
 * looked like a set of normal-only cards, an unpriced set looked like a free
 * one, a full device swallowed marks without a word, and an offline device
 * looked like an app ignoring taps.
 */
function Notices({
  printingsKnown,
  settled,
  visibleCount,
  priced,
  storageDegraded,
  offline,
}: {
  printingsKnown: boolean;
  settled: boolean;
  visibleCount: number;
  priced: number;
  storageDegraded: boolean;
  offline: boolean;
}) {
  const unpriced = settled && visibleCount > 0 && priced < visibleCount;

  if (!storageDegraded && !offline && !unpriced && (printingsKnown || !settled)) return null;

  return (
    <Stack gap={2}>
      {settled && !printingsKnown ? (
        <p className={styles.notice} role="status">
          No printing data for this set yet — one pocket per card until it arrives. Marking still works.
        </p>
      ) : null}

      {/*
       * The partial form, not a bare total. Pitch Black returns `prices: {}`
       * for all 120 of its cards, which is normal rather than an error — but a
       * screen that quietly showed "Unavailable" 360 times and no explanation
       * reads as broken.
       */}
      {unpriced ? (
        <p className={styles.notice} role="status">
          {priced === 0
            ? `No prices for these ${visibleCount} printings — the provider has none for this set.`
            : `${priced} of ${visibleCount} printings priced.`}
        </p>
      ) : null}

      {offline ? (
        <p className={styles.notice} role="status">
          Offline. Marks are saved on this device and sync when the server is reachable again.
        </p>
      ) : null}

      {storageDegraded ? (
        <p className={cx(styles.notice, styles.noticeWarn)} role="status">
          This device is out of storage. Marks are kept in memory and still sync, but reload before they do
          and the newest ones are lost.
        </p>
      ) : null}
    </Stack>
  );
}

/**
 * Two pages of empty pockets, in the shape of the content — never a spinner.
 *
 * Deliberately headingless. A skeleton titled "Page 1" puts a heading into the
 * document outline that names content nobody has yet, and a screen reader
 * announces it as if the set had arrived.
 */
function PageSkeletons() {
  return (
    <div className={styles.pages} aria-busy="true" aria-live="polite">
      <ScreenReaderOnly>Loading set</ScreenReaderOnly>
      {[1, 2].map((page) => (
        <Panel key={page}>
          <div className={styles.skeletonBar} />
          <div className={styles.pocketGrid}>
            {Array.from({ length: BINDER_PAGE_SIZE }, (_, i) => (
              <div key={i} className={styles.skeletonPocket} />
            ))}
          </div>
        </Panel>
      ))}
    </div>
  );
}
