import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { CardArt, Chip, Money, Panel, RailHost, Row, Sheet, Stack, cx } from "../../primitives/index.ts";
import { useLibrary } from "../../../app/LibraryProvider.tsx";
import { useBinderValue } from "../../../hooks/useBinderValue.ts";
import {
  addPage,
  addressKey,
  canRemoveLastPage,
  countBinder,
  fillSequential,
  pageGroups,
  putAt,
  removeLastPage,
  slotAt,
  specFor,
  type Binder,
  type BinderAddress,
  type BinderSlot,
  type CardSlot,
} from "../../../models/binderLayout.ts";
import { imageSlotSrc } from "../../../services/sync/binderImages.ts";
import { BinderSpread } from "./BinderSpread.tsx";
import { BinderPicker } from "./BinderPicker.tsx";
import { BinderSettings } from "./BinderSettings.tsx";
import { applyDrop, applyPlace } from "./binderEdits.ts";
import { useBinderDrag } from "./useBinderDrag.ts";
import { useWideLayout } from "./useWideLayout.ts";
import { addressPhrase, slotName } from "./pocketText.ts";
import styles from "./binder.module.css";

/**
 * Lay out one binder.
 *
 * Two ways in, because they suit different hands. SELECT-THEN-PLACE works with
 * a finger, a mouse and a keyboard without three implementations, and is how a
 * binder gets filled from nothing. DRAG moves what is already there, which is
 * how it gets tidied — and on touch that is a hold-then-move, because a press
 * that moves is a scroll.
 *
 * Cards are offered owned or not: planning a binder is mostly deciding where
 * the ones you are still chasing will go, so an unowned card must be placeable.
 * It renders shadowed and tagged — see BinderSpread.
 */
export function BinderScreen({ binderId }: { binderId: string }) {
  const { binders, saveBinder, ownedFinishes } = useLibrary();
  const binder = binders.find((b) => b.id === binderId) ?? null;

  /**
   * What is being filled: a pocket, or the cover.
   *
   * An ADDRESS rather than `{page, index}`, since the cover became fillable. A
   * sentinel page number was the alternative and it leaks: `nextEmptyPocket`
   * and `placeSlot` both do arithmetic on `page`, and `-1` is a number they
   * would happily accept.
   */
  const [selected, setSelected] = useState<BinderAddress | null>(null);
  /**
   * The picker rail, open or shut. Desktop only — below 1000px the picker is a
   * bottom sheet that appears with a selection, and there is nothing to shut.
   *
   * Shut until it is wanted. That is not a preference, it is arithmetic: two
   * 12-pocket pages plus the gutter need 1108px, and while a shut rail still
   * held grid track the binder beside it lost 33px of pocket — a 12-pocket page
   * drew 92px pockets against a 9-pocket page's 125px, which is exactly the
   * "same card at two sizes depending on which binder it was filed in" bug that
   * "a pocket is a pocket" exists to prevent. `RailHost` guarantees the zero.
   */
  const [railOpen, setRailOpen] = useState(false);
  const wide = useWideLayout();

  // Priced per printing, ONE request per SET rather than per card. A binder
  // spans sets the way a set screen never does — the Riolu one touches thirty.
  const value = useBinderValue(binder);

  /**
   * Ownership as a predicate, because that is what `BinderSpread` takes — and
   * it takes a predicate because a shared binder is judged against the
   * SHARER's collection, not the viewer's. Here the two are the same person.
   */
  const owns = useMemo(
    () => (slot: BinderSlot) =>
      slot.kind === "image" ? true : ownedFinishes(slot.cardId).includes(slot.finish),
    [ownedFinishes],
  );

  /**
   * A drag landed. The decisions live in `binderEdits`, which is pure.
   *
   * Held in a ref-free closure over the current binder; `useBinderDrag` reads
   * it through a ref of its own so the document listeners never go stale.
   */
  const drop = useCallback(
    (source: Parameters<typeof applyDrop>[1], slot: BinderSlot, to: BinderAddress) => {
      if (!binder) return;
      const result = applyDrop(binder, source, slot, to, Date.now());
      saveBinder(result.binder);
      if (result.select !== undefined) setSelected(result.select);
    },
    [binder, saveBinder],
  );

  const { drag, onPointerDown, consumeClick } = useBinderDrag(drop);
  const dropTarget = drag?.over ?? null;
  const draggingFrom = drag && drag.source.kind === "address" ? addressKey(drag.source.at) : null;

  /**
   * Keep the pocket being filled on screen.
   *
   * The picker is a sticky half of a phone display, so the page it is filling
   * scrolls out from under it — and after a place the selection moves to a
   * pocket that may be further down still. Without this a binder is filled
   * blind: cards land somewhere and the only evidence is the counter.
   */
  const selectedKey = selected ? addressKey(selected) : null;
  const lastScrolled = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedKey || selectedKey === lastScrolled.current) return;
    lastScrolled.current = selectedKey;
    document
      .querySelector(`[data-pocket="${selectedKey}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [selectedKey]);

  if (!binder) {
    return (
      <Panel title="Binder not found" tone="raised">
        <Stack gap={3}>
          <p>That binder no longer exists. It may have been deleted on another device and synced away.</p>
          <Row gap={2}>
            <a className={styles.button} href="#/binders">
              Back to binders
            </a>
          </Row>
        </Stack>
      </Panel>
    );
  }

  const spec = specFor(binder.format);
  const counts = countBinder(binder);
  const selectedSlot = selected ? slotAt(binder, selected) : null;

  /**
   * No trimming, ever.
   *
   * It used to run on every commit, which meant "Add page" grew the binder and
   * the same call dropped the new empty page again — the button did nothing, in
   * silence, for as long as binders existed. A blank page kept on purpose and a
   * blank page left over look identical, so the app cannot tell them apart and
   * must not guess. Deciding is one button press.
   */
  const commit = (next: Binder) => saveBinder(next);

  const place = (slot: BinderSlot | null) => {
    const result = applyPlace(binder, selected, slot, Date.now());
    if (!result) return;
    commit(result.binder);
    if (result.select !== undefined) setSelected(result.select);
  };

  /** Rewrite the selected pocket and STAY on it. Counting is not filling. */
  const update = (slot: CardSlot) => {
    if (!selected) return;
    commit(putAt(binder, selected, slot, Date.now()));
  };

  /**
   * A completed drag leaves a click behind on whatever it was dropped on.
   *
   * Swallowed here rather than in the hook, because it is the SELECTION that
   * must not happen. Rearranging a binder is not filling one: dropping a card
   * into pocket 5 and having the picker open on pocket 5 answers a question
   * nobody asked, once per card, while a page is being tidied.
   */
  const selectAt = (at: BinderAddress) => {
    if (consumeClick()) return;
    const same = selected !== null && addressKey(selected) === addressKey(at);
    // Choosing a pocket IS asking for cards, so the rail comes out with it.
    // Deselecting leaves it as it is: shutting the picker because you tapped
    // the same pocket twice would take the card list away mid-fill.
    if (!same) setRailOpen(true);
    setSelected(same ? null : at);
  };

  const picker = (
    <BinderPicker
      selected={selected}
      selectedSlot={selectedSlot}
      forTrade={Boolean(binder.forTrade)}
      onPlace={place}
      onUpdate={update}
      onFill={(slots) => {
        commit(fillSequential(binder, slots, Date.now()));
        setSelected(null);
      }}
      onDragNew={(event: ReactPointerEvent, slot: BinderSlot) => onPointerDown(event, { kind: "new" }, slot)}
      consumeClick={consumeClick}
      priceFor={value.priceFor}
    />
  );

  const pages = (
    <Stack gap={5}>
      <p className={styles.hint} aria-live="polite">
        {selected
          ? `Filling ${addressPhrase(selected)} — pick a card, or clear it.`
          : "Choose a pocket to fill it, or drag a card from one pocket to another."}
      </p>
      {pageGroups(binder.pages.length, binder.format).map((group, i) => (
        <BinderSpread
          key={group[0]}
          binder={binder}
          pages={group}
          owns={owns}
          priceFor={value.priceFor}
          trade={Boolean(binder.forTrade)}
          onSelect={selectAt}
          selected={selected}
          onSlotPointerDown={(at, slot, event) => onPointerDown(event, { kind: "address", at }, slot)}
          dropTarget={dropTarget}
          draggingFrom={draggingFrom}
          headingLevel={2}
          eager={i === 0}
        />
      ))}
    </Stack>
  );

  return (
    <Stack gap={4}>
      <Stack gap={2}>
        <h1 className={styles.title}>{binder.name}</h1>
        <Row gap={2} wrap>
          {/* The cover is NOT in this count. It is not one of the pockets you
              are filling — see `cover` on the Binder model. */}
          <Chip>
            {counts.filled} of {counts.pockets} pockets filled
          </Chip>
          <Chip>{spec.label}</Chip>
        </Row>
      </Stack>

      {/* Page actions only. Everything that configures the binder itself lives
          in Settings, because those are decided once and these are pressed
          constantly. */}
      <Row gap={2} wrap>
        <button type="button" className={styles.button} onClick={() => commit(addPage(binder, Date.now()))}>
          Add page
        </button>
        {/* Offered only when it would do something, and only for an EMPTY last
            page — removing one that holds cards would destroy them with no
            undo. */}
        <button
          type="button"
          className={styles.button}
          disabled={!canRemoveLastPage(binder)}
          onClick={() => commit(removeLastPage(binder, Date.now()))}
        >
          Remove page
        </button>
        {wide ? (
          /* The rail's own handle cannot live IN the rail: a shut rail takes
             zero width, so there would be nothing to press. */
          <button
            type="button"
            className={cx(styles.button, railOpen && styles.buttonOn)}
            aria-expanded={railOpen}
            onClick={() => setRailOpen((open) => !open)}
          >
            {railOpen ? "Hide cards" : "Cards"}
          </button>
        ) : null}
      </Row>

      <BinderSettings binder={binder} onSave={commit} />

      {wide ? (
        <RailHost open={railOpen} label="Cards" rail={railOpen ? picker : null}>
          {pages}
        </RailHost>
      ) : (
        <>
          {pages}
          {/*
           * The phone picker: a sheet along the bottom that appears when a
           * pocket is selected. This is the layout confirmed on hardware. On a
           * desktop the same sheet spent the bottom third of a 1440x900 window
           * on a card list while the binder it was filling scrolled out of
           * sight above it, which is why the rail exists instead.
           */}
          <Sheet open={selected !== null} onClose={() => setSelected(null)} label="Cards">
            {picker}
          </Sheet>
        </>
      )}

      <p className={styles.footnote}>
        {/* On a trade binder the count that matters is COPIES — twelve pockets
            can hold thirty cards, and thirty is what is being offered. */}
        {binder.forTrade
          ? `${counts.copies} card${counts.copies === 1 ? "" : "s"} in ${counts.cards} pocket${
              counts.cards === 1 ? "" : "s"
            }`
          : `${counts.cards} card${counts.cards === 1 ? "" : "s"}`}{" "}
        across {binder.pages.length} page{binder.pages.length === 1 ? "" : "s"} ·{" "}
        {/* The total is only ever "the part we know". Saying how many pockets
            are unpriced beside it is what keeps it from reading as the whole
            answer — stamps and promos price at nothing, and a binder of them
            would otherwise look worthless rather than unmeasured. */}
        <Money value={value.total} loading={value.isLoading} absentLabel="Unpriced" />
        {!value.isLoading && value.unpriced > 0 ? ` (${value.unpriced} unpriced)` : ""}
      </p>

      {/*
       * The card under the pointer while it is being carried.
       *
       * Fixed to the viewport and `pointer-events: none`, which is not
       * cosmetic: the hit test that decides where the card lands is
       * `elementFromPoint` at the pointer, and a ghost that took events would
       * be the answer to every one of those tests.
       */}
      {drag ? (
        <div className={styles.ghost} style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          {drag.slot.kind === "card" ? (
            <CardArt src={drag.slot.imageSmall} name={slotName(drag.slot)} detail="pocket" decorative />
          ) : (
            <img className={styles.customArt} src={imageSlotSrc(drag.slot)} alt="" />
          )}
        </div>
      ) : null}
    </Stack>
  );
}
