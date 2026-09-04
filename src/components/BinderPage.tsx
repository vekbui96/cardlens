import type React from "react";
import { CardImage } from "./CardImage.tsx";
import { imageSlotSrc } from "../services/sync/binderImages.ts";
import {
  specFor,
  type BinderFormat,
  type BinderPage as PageData,
  type BinderSlot,
} from "../models/binderLayout.ts";
import { formatBinderPrice, pocketAddress, spokenStock, stockLabel } from "../models/binderPocket.ts";
import styles from "./BinderPage.module.css";

/**
 * One side of a binder page, in a given format.
 *
 * The reusable piece: the builder, the viewer and anything shared later all
 * render through this, so a pocket looks and behaves the same everywhere and
 * the grid geometry lives in exactly one place.
 *
 * It knows nothing about storage or the collection. Ownership arrives as a
 * predicate, because "do I own this" is a question only the caller can answer
 * — a shared binder is judged against the sharer's collection, not the
 * viewer's.
 */
export function BinderPageView({
  page,
  format,
  owns,
  onSlotClick,
  selectedIndex,
  pageNumber,
  priceFor,
  trade,
  onSlotPointerDown,
  dropTarget,
  draggingFrom,
}: {
  page: PageData;
  format: BinderFormat;
  /** True when the viewer's collection contains this slot. Images are always "held". */
  owns: (slot: BinderSlot) => boolean;
  /** Omit for a read-only binder — pockets stop being buttons. */
  onSlotClick?: (index: number) => void;
  selectedIndex?: number | null;
  pageNumber: number;
  /**
   * Market price per pocket. Omit to show no prices at all.
   *
   * Returning undefined is meaningful and common — a stamp or promo rides on a
   * finish nothing prices — so it renders "n/a" rather than nothing. A blank
   * where a price belongs reads as "still loading" forever.
   */
  priceFor?: (slot: BinderSlot) => number | undefined;
  /**
   * Render this page as a trade list rather than as a layout.
   *
   * It adds two marks a binder you are building has no use for: the POCKET
   * ADDRESS, because a trade is negotiated by saying "page 2, pocket 5" out
   * loud and counting pockets on a screen is the friction that costs; and the
   * STOCK — copies and grade — because those are what the other collector is
   * actually deciding about.
   *
   * A flag rather than a second component, so a pocket looks and behaves the
   * same in both places and the grid geometry stays in one file.
   */
  trade?: boolean;
  /**
   * A pocket was pressed with something in it — a drag may be starting.
   *
   * Optional, and separate from `onSlotClick`, because a press is not yet a
   * gesture: the screen decides whether it becomes a drag or stays a tap. See
   * useBinderDrag. A read-only binder (the trade page) passes neither and its
   * pockets stay plain.
   */
  onSlotPointerDown?: (index: number, slot: BinderSlot, event: React.PointerEvent) => void;
  /** `data-pocket` of the pocket a dragged card is currently over. */
  dropTarget?: string | null;
  /** `data-pocket` of the pocket a card was picked up from, while it is in the air. */
  draggingFrom?: string | null;
}) {
  const spec = specFor(format);
  const interactive = typeof onSlotClick === "function";
  return (
    <section className={styles.page} aria-label={`Page ${pageNumber}`}>
      <header className={styles.head}>
        <span className={styles.pageNumber}>Page {pageNumber}</span>
        <span className={styles.format}>{spec.label}</span>
      </header>

      <ul className={styles.grid} style={{ gridTemplateColumns: `repeat(${spec.cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: spec.pockets }, (_, index) => {
          const slot = page.slots[index];
          const held = slot ? owns(slot) : false;
          // Screen readers get the address spelled out rather than "2 dot 5",
          // and the stock as words rather than a multiplication sign.
          const label =
            (trade ? `Page ${pageNumber}, ` : "") +
            slotLabel(slot, index, held) +
            (trade && slot ? spokenStock(slot) : "") +
            (priceFor && slot ? `, ${formatBinderPrice(priceFor(slot))}` : "");
          const inner = slot ? (
            <>
              {slot.kind === "card" ? (
                <CardImage src={slot.imageSmall} alt="" size="thumb" />
              ) : (
                // Custom art: the alt is the label because there is no catalog
                // entry to name it. The src is resolved HERE rather than stored,
                // because the binder travels between devices that reach the
                // server on different origins.
                <img className={styles.custom} src={imageSlotSrc(slot)} alt={slot.label ?? ""} />
              )}
              {/* Shadowed rather than hidden: a card you have not got yet is
                  the point of planning a binder, so it must be placeable and
                  visibly distinct from one you hold. */}
              {!held ? <span className={styles.wantedTag}>Don’t own</span> : null}
              {trade ? <span className={styles.address}>{pocketAddress(pageNumber, index)}</span> : null}
              {/* Only rendered when there is something to say. A binder of
                  single ungraded copies stays as clean as one that has never
                  been traded from. */}
              {trade && stockLabel(slot) ? (
                <span className={`${styles.stock} ${held ? "" : styles.stockAboveTag}`}>
                  {stockLabel(slot)}
                </span>
              ) : null}
              {priceFor ? (
                <span className={`${styles.price} ${held ? "" : styles.priceAboveTag}`}>
                  {formatBinderPrice(priceFor(slot))}
                </span>
              ) : null}{" "}
            </>
          ) : (
            <span className={styles.emptyMark} aria-hidden="true" />
          );

          const key = `${pageNumber - 1}:${index}`;
          const className = [
            styles.pocket,
            slot ? styles.filled : styles.empty,
            slot && !held ? styles.wanted : "",
            selectedIndex === index ? styles.selected : "",
            // Lit while a dragged card is over it, so the drop lands somewhere
            // the user chose rather than somewhere the pointer happened to be.
            dropTarget === key ? styles.dropOver : "",
            // The pocket a drag was picked UP from, faded while it is in the
            // air — otherwise the card appears to be in two places at once.
            draggingFrom === key ? styles.dragging : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <li key={index} className={styles.cell}>
              {interactive ? (
                <button
                  type="button"
                  className={className}
                  /* Two jobs, one attribute: the web shell scrolls the selected
                     pocket back into view after a place, and a drag hit-tests
                     against it with elementFromPoint. See addressKey. */
                  data-pocket={key}
                  aria-label={label}
                  aria-pressed={selectedIndex === index}
                  onClick={() => onSlotClick?.(index)}
                  onPointerDown={slot ? (event) => onSlotPointerDown?.(index, slot, event) : undefined}
                >
                  {inner}
                </button>
              ) : (
                <div className={className} aria-label={label} role="img">
                  {inner}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function slotLabel(slot: BinderSlot | undefined, index: number, held: boolean): string {
  const pocket = `Pocket ${index + 1}`;
  if (!slot) return `${pocket}, empty`;
  if (slot.kind === "image") return `${pocket}, ${slot.label ?? "custom image"}`;
  const name = slot.name ?? slot.cardId;
  return `${pocket}, ${name}, ${held ? "owned" : "not owned"}`;
}
