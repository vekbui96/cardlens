import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { CardArt, cx } from "../../primitives/index.ts";
import {
  addressKey,
  specFor,
  type BinderFormat,
  type BinderPage,
  type BinderSlot,
} from "../../../models/binderLayout.ts";
import { formatBinderPrice, pocketAddress, stockLabel } from "../../../models/binderPocket.ts";
import { pageVars, pocketLabel, slotArt, slotTitle } from "./binderBuilder.ts";
import styles from "./binder.module.css";

/**
 * One side of a binder page.
 *
 * Every pocket is a real `<button>` carrying `data-pocket`, and that attribute
 * does two jobs that must not disagree: a drag hit-tests against it with
 * `elementFromPoint` (see `features/binders/useBinderDrag.ts`), and the screen
 * scrolls the chosen pocket back into view through it. Two encodings would mean
 * a drop that lands somewhere the scroller cannot find, so both come from
 * `addressKey`.
 *
 * The geometry is `--cols` and `--rows` and nothing else — a fourth format would
 * need no new number here. How BIG a pocket is belongs to the stylesheet, where
 * it can be a `calc()` over the tokens.
 */
export function BinderPageView({
  page,
  pageNumber,
  format,
  owns,
  priceFor,
  trade,
  selectedIndex,
  dropTarget,
  draggingFrom,
  side,
  onSelect,
  onPointerDown,
}: {
  page: BinderPage | undefined;
  /** 1-based, the way the person holding the binder counts. */
  pageNumber: number;
  format: BinderFormat;
  /** True when the collection holds this slot. A predicate, because which
      collection is the caller's business — a shared binder is judged against
      the sharer's. */
  owns: (slot: BinderSlot) => boolean;
  priceFor: (slot: BinderSlot) => number | undefined;
  /** Show the pocket address and the stock. Only a trade binder wants either. */
  trade: boolean;
  selectedIndex: number | null;
  /** `data-pocket` of the pocket a carried card is over, or null. */
  dropTarget: string | null;
  /** `data-pocket` of the pocket a card was picked up from, while it is airborne. */
  draggingFrom: string | null;
  /** Which half of the spread this leaf sits in, so it can hug the gutter. */
  side: "left" | "right" | "solo";
  onSelect: (index: number) => void;
  onPointerDown: (index: number, slot: BinderSlot, event: ReactPointerEvent) => void;
}) {
  const spec = specFor(format);

  return (
    <section
      className={cx(styles.frame, side === "left" && styles.sideLeft, side === "right" && styles.sideRight)}
      style={pageVars(format) as CSSProperties}
      data-format={format}
      aria-labelledby={`v2-binder-page-${pageNumber}`}
    >
      <header className={styles.pageHead}>
        <h2 className={styles.pageNumber} id={`v2-binder-page-${pageNumber}`}>
          Page {pageNumber}
        </h2>
        <span className={styles.pageFormat}>{spec.label}</span>
      </header>

      <ul className={styles.page}>
        {Array.from({ length: spec.pockets }, (_, index) => {
          const slot = page?.slots[index];
          const held = slot ? owns(slot) : false;
          const price = slot ? priceFor(slot) : undefined;
          const key = addressKey({ kind: "pocket", page: pageNumber - 1, index });
          const stock = slot && trade ? stockLabel(slot) : "";

          return (
            <li key={index}>
              <button
                type="button"
                className={cx(
                  styles.pocket,
                  selectedIndex === index && styles.pocketSelected,
                  dropTarget === key && styles.pocketOver,
                  draggingFrom === key && styles.pocketDragging,
                )}
                data-pocket={key}
                aria-label={pocketLabel({ slot, index, pageNumber, held, trade, price })}
                aria-pressed={selectedIndex === index}
                onClick={() => onSelect(index)}
                /* Only a pocket with something in it can start a drag. A press
                   on an empty one is a tap, always. */
                onPointerDown={slot ? (event) => onPointerDown(index, slot, event) : undefined}
              >
                {slot ? (
                  <>
                    {/*
                      Decorative: the button's own label already names the card,
                      whether it is owned, and what it is worth. A screen reader
                      read twelve card names it cannot act on is worse than
                      silence — and every mark below is a glyph or a colour,
                      which is why the label carries all of it in words.
                    */}
                    <CardArt
                      src={slotArt(slot)}
                      name={slotTitle(slot)}
                      detail="pocket"
                      decorative
                      className={cx(styles.art, !held && styles.wanted)}
                    />
                    {/* Shadowed art is a colour, and colour is never the only
                        carrier of meaning. The card stays placeable: planning
                        around what you have not got yet is the point. */}
                    {held ? null : (
                      <span className={cx(styles.mark, styles.tag)} aria-hidden="true">
                        Don’t own
                      </span>
                    )}
                    {trade ? (
                      <span className={cx(styles.mark, styles.address)} aria-hidden="true">
                        {pocketAddress(pageNumber, index)}
                      </span>
                    ) : null}
                    {/* Only when there is something to say. A binder of single
                        ungraded copies stays as clean as one never traded from. */}
                    {stock ? (
                      <span className={cx(styles.mark, styles.stock)} aria-hidden="true">
                        {stock}
                      </span>
                    ) : null}
                    {/*
                      "n/a", never blank. A price this app genuinely does not
                      know is a real answer — stamps and promos ride on finishes
                      the oracle has never heard of — and a blank where a price
                      belongs reads as "still loading" forever.
                    */}
                    <span className={cx(styles.mark, styles.price)} aria-hidden="true">
                      {formatBinderPrice(price)}
                    </span>
                  </>
                ) : (
                  <CardArt name="" empty className={styles.art} />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
