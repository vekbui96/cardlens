import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { finishLabel } from "../../../models/finishes.ts";
import type { OwnedPrintingRow } from "../../../models/ownedSort.ts";
import { CardArt, Money, Stack, cx } from "../../primitives/index.ts";
import styles from "./collection.module.css";

interface ShowcaseProps {
  rows: OwnedPrintingRow[];
  /** Open the full card. Absent means the stage is display-only. */
  onOpen?: (row: OwnedPrintingRow) => void;
}

/**
 * One printing held, shown large, with the rest scrolling beneath it.
 *
 * The list beside it answers "what do I have and what is it worth" — dense on
 * purpose, and 887 rows of it read as a spreadsheet. This answers a different
 * question: it puts the card itself on screen at a size worth looking at, and
 * makes moving to the next one a scroll rather than a page change.
 *
 * ## The stage does not move when the strip scrolls
 *
 * This is the whole reason the strip is scrolled by hand rather than with
 * `scrollIntoView`. That method scrolls every scrollable ancestor it needs to,
 * including the document — so walking the filmstrip with the arrow keys dragged
 * the page down and the large card, the thing being chosen, left the screen.
 * `block: "nearest"` reduces it but does not remove it, because "nearest" is
 * still a scroll when the element is even slightly out of view.
 *
 * Setting `scrollLeft` on the strip itself cannot touch an ancestor, and
 * `focus({ preventScroll: true })` stops the browser doing it afterwards. Both
 * halves are required: focus has to move for the roving tabindex to mean
 * anything.
 *
 * Selection lives here rather than in the parent: nothing outside needs to know
 * which card is staged, and lifting it would make every keystroke a re-render
 * of the whole list.
 */
export function Showcase({ rows, onOpen }: ShowcaseProps) {
  const [index, setIndex] = useState(0);
  const strip = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  // A re-sort or a removal can leave the selection past the end. Clamping in an
  // effect rather than at render keeps the stage on the same card when the list
  // merely grows.
  useEffect(() => {
    setIndex((i) => (i < rows.length ? i : 0));
  }, [rows.length]);

  const current = rows[Math.min(index, rows.length - 1)];

  const select = useCallback((next: number, focus = false) => {
    setIndex(next);
    const el = items.current[next];
    const host = strip.current;
    if (!el || !host) return;
    // Centre it in the STRIP, by hand. See the note above: nothing here may
    // scroll an ancestor, because the stage is one.
    host.scrollTo({
      left: el.offsetLeft - (host.clientWidth - el.clientWidth) / 2,
      behavior: "smooth",
    });
    if (focus) el.focus({ preventScroll: true });
  }, []);

  /**
   * The arrow keys, handled natively.
   *
   * v2 does not install the wearable keyboard adapter — that adapter
   * `preventDefault()`s arrows at the document level, which is correct on the
   * glasses where those keys ARE the gestures and wrong on a web page where
   * they are how everything else scrolls. So this listener owns only the keys
   * it acts on and lets every other one through.
   */
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
    e.preventDefault();
    select(to, true);
  };

  if (!current) return null;

  return (
    <Stack gap={4}>
      {/* Measured by the e2e: this box may not move when the strip scrolls. */}
      <div className={styles.stage} data-testid="showcase-stage">
        {/*
          Keyed by printing so React swaps the <img> instead of holding the
          previous card's pixels while the next one loads. `hero` asks the CDN
          for a large image; it is not a size on the page — the container is.
        */}
        <div className={styles.stageArt}>
          <CardArt
            key={`${current.cardId}|${current.finish}`}
            src={current.imageLarge ?? current.imageSmall}
            name={current.name}
            detail="hero"
            eager
          />
        </div>

        <Stack gap={2} className={styles.stageFacts}>
          <p className={styles.position} aria-live="polite">
            {index + 1} of {rows.length}
          </p>
          <h3 className={styles.stageName}>{current.name}</h3>
          <p className={styles.muted}>
            {finishLabel(current.finish)} · {current.setName} {current.collectorNumber}
          </p>
          <p className={styles.stagePrice}>
            <Money value={current.price} absentLabel="No price upstream" />
          </p>
          {onOpen ? (
            <p>
              <button type="button" className={styles.button} onClick={() => onOpen(current)}>
                Open card
              </button>
            </p>
          ) : null}
        </Stack>
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
            className={cx(styles.thumb, i === index && styles.thumbOn)}
            onClick={() => select(i)}
          >
            <span className={styles.thumbArt}>
              <CardArt src={row.imageSmall} name={row.name} detail="tile" decorative />
            </span>
            <span className={styles.thumbName}>{row.name}</span>
            <span className={styles.thumbPrice}>
              <Money value={row.price} absentLabel="—" />
            </span>
          </button>
        ))}
      </div>
    </Stack>
  );
}
