import { CardImage } from "./CardImage.tsx";
import { imageSlotSrc } from "../services/sync/binderImages.ts";
import {
  specFor,
  type BinderFormat,
  type BinderPage as PageData,
  type BinderSlot,
} from "../models/binderLayout.ts";
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
          const label =
            slotLabel(slot, index, held) + (priceFor && slot ? `, ${formatBinderPrice(priceFor(slot))}` : "");

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
              {priceFor ? (
                <span className={`${styles.price} ${held ? "" : styles.priceAboveTag}`}>
                  {formatBinderPrice(priceFor(slot))}
                </span>
              ) : null}
            </>
          ) : (
            <span className={styles.emptyMark} aria-hidden="true" />
          );

          const className = [
            styles.pocket,
            slot ? styles.filled : styles.empty,
            slot && !held ? styles.wanted : "",
            selectedIndex === index ? styles.selected : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <li key={index} className={styles.cell}>
              {interactive ? (
                <button
                  type="button"
                  className={className}
                  /* The web shell scrolls the selected pocket back into view
                     after a place; it needs to find that one button among the
                     several pressable things on the screen. */
                  data-pocket={`${pageNumber - 1}:${index}`}
                  aria-label={label}
                  aria-pressed={selectedIndex === index}
                  onClick={() => onSlotClick?.(index)}
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

/** Compact enough for a pocket: "$12.34", "$1.2k", or "n/a". */
export function formatBinderPrice(price: number | undefined): string {
  if (price === undefined || !Number.isFinite(price) || price <= 0) return "n/a";
  if (price >= 1000) return `$${(price / 1000).toFixed(price >= 10_000 ? 0 : 1)}k`;
  return `$${price.toFixed(price >= 100 ? 0 : 2)}`;
}

function slotLabel(slot: BinderSlot | undefined, index: number, held: boolean): string {
  const pocket = `Pocket ${index + 1}`;
  if (!slot) return `${pocket}, empty`;
  if (slot.kind === "image") return `${pocket}, ${slot.label ?? "custom image"}`;
  const name = slot.name ?? slot.cardId;
  return `${pocket}, ${name}, ${held ? "owned" : "not owned"}`;
}
