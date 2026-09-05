import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { CardArt, cx } from "../../primitives/index.ts";
import {
  addressKey,
  hasFacingPages,
  sameAddress,
  specFor,
  type Binder,
  type BinderAddress,
  type BinderSlot,
} from "../../../models/binderLayout.ts";
import { formatBinderPrice, pocketAddress, stockLabel } from "../../../models/binderPocket.ts";
import { imageSlotSrc } from "../../../services/sync/binderImages.ts";
import { coverLabel, pocketLabel, slotName } from "./pocketText.ts";
import styles from "./binder.module.css";

/**
 * One spread of a binder, as it falls open.
 *
 * **This is the shared piece.** The builder renders it and so does the public
 * trade page (spec 07), which is the whole reason it takes props rather than
 * reading anything: the owner has to see exactly what the recipient will see,
 * and a separate preview is a second implementation that drifts. Everything
 * that differs between the two arrives as a prop — ownership as a predicate,
 * interaction as callbacks that may simply be absent.
 *
 * `owns` is a PREDICATE because "do I own this" is a question only the caller
 * can answer: a shared binder is judged against the SHARER's collection, not
 * the viewer's, and a viewer looking at somebody else's trade binder must not
 * see their own gaps marked on it.
 *
 * Read-only is the absence of `onSelect`. Pockets stop being buttons and become
 * `role="img"` with the same accessible name — a surface that looks pressable
 * and is not is how a UI lies, and a share page has nothing to press.
 *
 * ONE spread, not the whole binder. The caller groups the pages, because that
 * grouping is a domain decision with its own off-by-one:
 *
 *   pageGroups(binder.pages.length, binder.format).map((pages) => (
 *     <BinderSpread key={pages[0]} binder={binder} pages={pages} owns={owns} />
 *   ))
 */
export interface BinderSpreadProps {
  binder: Binder;
  /** Page indices in this group — one or two, from `pageGroups`. */
  pages: number[];
  /** True when the collection this binder is judged against holds the slot. */
  owns: (slot: BinderSlot) => boolean;
  /**
   * Market price for ONE copy in a pocket. Omit to show no prices at all.
   *
   * Returning `undefined` is meaningful and common — a stamp or a promo rides
   * on a finish nothing prices — so it renders "n/a" rather than nothing. A
   * blank where a price belongs reads as "still loading", forever.
   */
  priceFor?: ((slot: BinderSlot) => number | undefined) | undefined;
  /**
   * Render as a trade list rather than as a layout: pocket addresses, copies
   * and grade. A flag rather than a second component, so a pocket looks and
   * behaves the same in both places and the geometry stays in one file.
   */
  trade?: boolean;
  /**
   * Draw the inside front cover beside page 1. Defaults to "when this spread
   * contains page 1", which is what a binder does.
   */
  showCover?: boolean;
  /** Omit for a read-only binder — pockets stop being buttons. */
  onSelect?: ((at: BinderAddress) => void) | undefined;
  selected?: BinderAddress | null;
  /**
   * A pocket was pressed with something in it. Separate from `onSelect`,
   * because a press is not yet a gesture: the screen decides whether it becomes
   * a drag or stays a tap. See `useBinderDrag`.
   */
  onSlotPointerDown?: ((at: BinderAddress, slot: BinderSlot, event: ReactPointerEvent) => void) | undefined;
  /** `data-pocket` of the pocket a dragged card is over. */
  dropTarget?: string | null;
  /** `data-pocket` of the pocket a card was picked up from, while it is in the air. */
  draggingFrom?: string | null;
  /** Page headings descend from whatever the host page's last heading was. */
  headingLevel?: 2 | 3 | 4;
  /** First spread only; everything below the fold should stay lazy. */
  eager?: boolean;
}

export function BinderSpread({
  binder,
  pages,
  owns,
  priceFor,
  trade = false,
  showCover,
  onSelect,
  selected,
  onSlotPointerDown,
  dropTarget,
  draggingFrom,
  headingLevel = 2,
  eager = false,
}: BinderSpreadProps) {
  const spec = specFor(binder.format);
  const facing = hasFacingPages(binder.format);
  const withCover = showCover ?? pages.includes(0);
  // The column count has to be on the SPREAD, not on the page: the cover leaf
  // is drawn beside the page and CSS cannot read a sibling's custom property.
  const vars = { "--binder-cols": spec.cols } as CSSProperties;

  return (
    <div
      className={styles.spread}
      style={vars}
      // A format with no facing pages is one page per row. See hasFacingPages.
      data-solo={!facing || undefined}
      // Page 1 opens on the RIGHT, against the inside front cover — the same
      // reason a book's first page is a right-hand page. Every later lone page
      // is a trailing even one, sitting on the left with its facing side still
      // to be added. Meaningless without facing pages.
      data-cover={(facing && pages[0] === 0) || undefined}
      // So a 4-pocket page can draw the bigger pockets it exists for.
      data-binder-format={binder.format}
    >
      {withCover ? (
        <CoverLeaf
          binder={binder}
          owns={owns}
          {...(onSelect ? { onSelect } : {})}
          {...(onSlotPointerDown ? { onSlotPointerDown } : {})}
          selected={selected?.kind === "cover"}
          dropOver={dropTarget === "cover"}
          dragging={draggingFrom === "cover"}
          eager={eager}
        />
      ) : null}

      {pages.map((page) => (
        <Page
          key={page}
          binder={binder}
          page={page}
          owns={owns}
          priceFor={priceFor}
          trade={trade}
          {...(onSelect ? { onSelect } : {})}
          {...(onSlotPointerDown ? { onSlotPointerDown } : {})}
          selected={selected ?? null}
          dropTarget={dropTarget ?? null}
          draggingFrom={draggingFrom ?? null}
          headingLevel={headingLevel}
          eager={eager}
        />
      ))}
    </div>
  );
}

/* --- One page ------------------------------------------------------------- */

interface PageProps {
  binder: Binder;
  page: number;
  owns: (slot: BinderSlot) => boolean;
  priceFor?: ((slot: BinderSlot) => number | undefined) | undefined;
  trade: boolean;
  onSelect?: ((at: BinderAddress) => void) | undefined;
  onSlotPointerDown?: ((at: BinderAddress, slot: BinderSlot, event: ReactPointerEvent) => void) | undefined;
  selected: BinderAddress | null;
  dropTarget: string | null;
  draggingFrom: string | null;
  headingLevel: 2 | 3 | 4;
  eager: boolean;
}

function Page({
  binder,
  page,
  owns,
  priceFor,
  trade,
  onSelect,
  onSlotPointerDown,
  selected,
  dropTarget,
  draggingFrom,
  headingLevel,
  eager,
}: PageProps) {
  const spec = specFor(binder.format);
  const slots = binder.pages[page]?.slots ?? {};
  const pageNumber = page + 1;
  const Heading = `h${headingLevel}` as const;

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <Heading className={styles.pageNumber}>Page {pageNumber}</Heading>
        <span className={styles.pageFormat}>{spec.label}</span>
      </div>

      <ul className={styles.pockets}>
        {Array.from({ length: spec.pockets }, (_, index) => {
          const at: BinderAddress = { kind: "pocket", page, index };
          return (
            <li key={index} className={styles.cell}>
              <Pocket
                at={at}
                slot={slots[index]}
                index={index}
                pageNumber={pageNumber}
                owns={owns}
                priceFor={priceFor}
                trade={trade}
                {...(onSelect ? { onSelect } : {})}
                {...(onSlotPointerDown ? { onSlotPointerDown } : {})}
                selected={selected !== null && sameAddress(selected, at)}
                dropOver={dropTarget === addressKey(at)}
                dragging={draggingFrom === addressKey(at)}
                eager={eager}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* --- One pocket ----------------------------------------------------------- */

interface PocketProps {
  at: BinderAddress;
  slot: BinderSlot | undefined;
  index: number;
  pageNumber: number;
  owns: (slot: BinderSlot) => boolean;
  priceFor?: ((slot: BinderSlot) => number | undefined) | undefined;
  trade: boolean;
  onSelect?: ((at: BinderAddress) => void) | undefined;
  onSlotPointerDown?: ((at: BinderAddress, slot: BinderSlot, event: ReactPointerEvent) => void) | undefined;
  selected: boolean;
  dropOver: boolean;
  dragging: boolean;
  eager: boolean;
}

function Pocket({
  at,
  slot,
  index,
  pageNumber,
  owns,
  priceFor,
  trade,
  onSelect,
  onSlotPointerDown,
  selected,
  dropOver,
  dragging,
  eager,
}: PocketProps) {
  const held = slot ? owns(slot) : false;
  const price = slot && priceFor ? priceFor(slot) : undefined;
  const label = pocketLabel({
    slot,
    index,
    pageNumber,
    held,
    trade,
    price,
    priced: Boolean(priceFor),
  });

  const className = cx(
    styles.pocket,
    slot && styles.pocketFilled,
    slot && !held && styles.pocketWanted,
    selected && styles.pocketSelected,
    dropOver && styles.pocketDropOver,
    dragging && styles.pocketDragging,
  );

  const stock = slot && trade ? stockLabel(slot) : "";
  const inner = (
    <>
      <SlotArt slot={slot} eager={eager} />
      {/* Shadowed AND tagged. Colour is never the only carrier of meaning, and
          a card you have not got yet is the point of planning a binder. */}
      {slot && !held ? <span className={cx(styles.mark, styles.wantedTag)}>Don&rsquo;t own</span> : null}
      {slot && trade ? (
        <span className={cx(styles.mark, styles.address)}>{pocketAddress(pageNumber, index)}</span>
      ) : null}
      {/* Only when there is something to say: a binder of single ungraded
          copies stays as clean as one that has never been traded from. */}
      {stock ? <span className={cx(styles.mark, styles.stock)}>{stock}</span> : null}
      {slot && priceFor ? (
        <span className={cx(styles.mark, styles.price, !held && styles.aboveTag)}>
          {formatBinderPrice(price)}
        </span>
      ) : null}
    </>
  );

  // The same attribute does two jobs that must not disagree: a drag hit-tests
  // against it with elementFromPoint, and the screen scrolls the selected
  // pocket back into view by querying it. See addressKey.
  const key = addressKey(at);

  if (!onSelect) {
    return (
      <div className={className} data-pocket={key} role="img" aria-label={label}>
        {inner}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={className}
      data-pocket={key}
      aria-label={label}
      aria-pressed={selected}
      onClick={() => onSelect(at)}
      onPointerDown={slot && onSlotPointerDown ? (event) => onSlotPointerDown(at, slot, event) : undefined}
    >
      {inner}
    </button>
  );
}

/* --- The cover ------------------------------------------------------------ */

interface CoverLeafProps {
  binder: Binder;
  owns: (slot: BinderSlot) => boolean;
  onSelect?: ((at: BinderAddress) => void) | undefined;
  onSlotPointerDown?: ((at: BinderAddress, slot: BinderSlot, event: ReactPointerEvent) => void) | undefined;
  selected: boolean;
  dropOver: boolean;
  dragging: boolean;
  eager: boolean;
}

/**
 * The leaf page 1 opens against.
 *
 * A real slot — fillable, and a drop target like any pocket — and emphatically
 * NOT a pocket: no index, excluded from the filled count, and untouched when
 * the binder is reformatted between 9 and 12. See `cover` on the Binder model
 * for why that distinction lives in the data rather than only here.
 */
function CoverLeaf({
  binder,
  owns,
  onSelect,
  onSlotPointerDown,
  selected,
  dropOver,
  dragging,
  eager,
}: CoverLeafProps) {
  const at: BinderAddress = { kind: "cover" };
  const slot = binder.cover ?? null;
  const held = slot ? owns(slot) : true;
  const className = cx(
    styles.pocket,
    styles.coverWindow,
    slot && styles.pocketFilled,
    slot && !held && styles.pocketWanted,
    selected && styles.pocketSelected,
    dropOver && styles.pocketDropOver,
    dragging && styles.pocketDragging,
  );

  const inner = slot ? (
    <SlotArt slot={slot} eager={eager} />
  ) : (
    // A window, not a call to action. An empty cover is the normal state for
    // most binders and should read as blank stationery, not as a chore.
    <span className={styles.coverEmptyMark} aria-hidden="true">
      +
    </span>
  );

  return (
    <div className={styles.coverLeaf}>
      {onSelect ? (
        <button
          type="button"
          className={className}
          data-pocket="cover"
          aria-label={coverLabel(slot)}
          aria-pressed={selected}
          onClick={() => onSelect(at)}
          onPointerDown={
            slot && onSlotPointerDown ? (event) => onSlotPointerDown(at, slot, event) : undefined
          }
        >
          {inner}
        </button>
      ) : (
        <div className={className} data-pocket="cover" role="img" aria-label={coverLabel(slot)}>
          {inner}
        </div>
      )}
      {/* The binder's name, printed on its own cover. The header says it too,
          but the header scrolls away and this is what makes the leaf read as
          the front of THIS binder rather than as a spare page. */}
      <span className={styles.coverName}>{binder.name}</span>
    </div>
  );
}

/* --- Art ------------------------------------------------------------------ */

function SlotArt({ slot, eager }: { slot: BinderSlot | undefined; eager: boolean }) {
  if (!slot) return <CardArt name="" empty className={styles.art} />;

  if (slot.kind === "card") {
    return (
      <CardArt
        src={slot.imageSmall}
        name={slotName(slot)}
        detail="pocket"
        decorative
        eager={eager}
        className={styles.art}
      />
    );
  }

  /*
   * Custom art bypasses CardArt on purpose.
   *
   * CardArt routes every image through the resizing CDN (wsrv.nl), which is
   * right for card art on a public host and impossible here: a binder image is
   * served from the user's OWN server — a Tailscale funnel, or localhost — and
   * a public proxy cannot reach either. The URL is resolved at render rather
   * than stored, because the binder travels between devices that reach that
   * server on different origins.
   */
  return (
    <img
      className={styles.customArt}
      src={imageSlotSrc(slot)}
      alt=""
      aria-hidden="true"
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
    />
  );
}
