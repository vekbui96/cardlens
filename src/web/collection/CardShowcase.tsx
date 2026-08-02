import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { finishLabel } from "../../models/finishes.ts";
import type { OwnedPrintingRow } from "../../models/ownedSort.ts";
import { formatUsd } from "../../utils/format.ts";
import styles from "./CardShowcase.module.css";

interface Props {
  rows: OwnedPrintingRow[];
  /** Open the full card. Absent means the stage is display-only. */
  onOpen?: (row: OwnedPrintingRow) => void;
}

/**
 * One printing held, shown large, with the rest scrolling beneath it.
 *
 * The list view answers "what do I have and what is it worth" — it is dense on
 * purpose, and 887 rows of it read as a spreadsheet. This answers a different
 * question: it puts the card itself on screen at a size worth looking at, and
 * makes moving to the next one a scroll rather than a page change.
 *
 * Web only, and it could not be otherwise. It rests on a pointer that can drag,
 * a viewport tall enough for art plus a filmstrip, and hi-res images — the
 * glasses have none of those, and on a 600x600 additive display black is
 * transparent, so a large photographic image is the one thing that renders
 * worst there.
 *
 * Selection lives here rather than in the parent screen: nothing outside needs
 * to know which card is on the stage, and lifting it would make every keystroke
 * a re-render of the whole list.
 */
export function CardShowcase({ rows, onOpen }: Props) {
  const [index, setIndex] = useState(0);
  const strip = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  // A re-sort or a removal can leave the selection past the end. Clamping in
  // an effect rather than at render keeps the stage on the same card when the
  // list merely grows.
  useEffect(() => {
    setIndex((i) => (i < rows.length ? i : 0));
  }, [rows.length]);

  const current = rows[Math.min(index, rows.length - 1)];

  const select = useCallback((next: number, focus = false) => {
    setIndex(next);
    const el = items.current[next];
    if (!el) return;
    // `nearest` on the block axis, or centring the thumbnail scrolls the whole
    // page and throws the stage off screen.
    el.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    if (focus) el.focus({ preventScroll: true });
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = rows.length - 1;
    const to =
      e.key === "ArrowRight"
        ? Math.min(index + 1, last)
        : e.key === "ArrowLeft"
          ? Math.max(index - 1, 0)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (to === null) return;
    // Only after a key we handle: swallowing arrows unconditionally would break
    // scrolling the page with the keyboard.
    e.preventDefault();
    select(to, true);
  };

  if (!current) return null;

  return (
    <div className={styles.showcase}>
      <div className={styles.stage}>
        {/*
          The art is the point, so it gets the space and everything else reads
          off it. Keyed by printing so React swaps the <img> instead of holding
          the previous card's pixels while the next one loads.
        */}
        <div className={styles.art}>
          {current.imageLarge || current.imageSmall ? (
            <img
              key={`${current.cardId}|${current.finish}`}
              src={current.imageLarge ?? current.imageSmall}
              alt={current.name}
              decoding="async"
            />
          ) : (
            <span className={styles.artMissing}>No image</span>
          )}
        </div>

        <div className={styles.facts}>
          <p className={styles.position} aria-live="polite">
            {index + 1} of {rows.length}
          </p>
          <h3 className={styles.name}>{current.name}</h3>
          <p className={styles.meta}>
            {finishLabel(current.finish)} · {current.setName} {current.collectorNumber}
          </p>
          <p className={current.price === undefined ? styles.noPrice : styles.price}>
            {current.price === undefined ? "No price upstream" : formatUsd(current.price)}
          </p>
          {onOpen ? (
            <button type="button" className={styles.open} onClick={() => onOpen(current)}>
              Open card
            </button>
          ) : null}
        </div>
      </div>

      {/*
        A listbox, not a list of links: exactly one thumbnail is chosen at a
        time and the arrow keys move that choice. Roving tabindex keeps Tab
        moving past the strip in one press instead of through 887 stops.
      */}
      <div
        ref={strip}
        className={styles.strip}
        role="listbox"
        aria-label="Cards you own"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {rows.map((row, i) => (
          <button
            key={`${row.cardId}|${row.finish}`}
            ref={(el) => {
              items.current[i] = el;
            }}
            type="button"
            role="option"
            aria-selected={i === index}
            tabIndex={i === index ? 0 : -1}
            className={`${styles.thumb} ${i === index ? styles.thumbOn : ""}`}
            onClick={() => select(i)}
          >
            <span className={styles.thumbArt}>
              {row.imageSmall ? <img src={row.imageSmall} alt="" loading="lazy" decoding="async" /> : null}
            </span>
            <span className={styles.thumbName}>{row.name}</span>
            <span className={row.price === undefined ? styles.thumbNoPrice : styles.thumbPrice}>
              {row.price === undefined ? "—" : formatUsd(row.price)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
