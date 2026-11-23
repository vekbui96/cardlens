import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { CardArt, Money, Panel, Stack, UNPRICED, cx } from "../../primitives/index.ts";
import type { Binder, BinderSlot } from "../../../models/binderLayout.ts";
import { finishLabel } from "../../../models/finishes.ts";
import { imageSlotSrc } from "../../../services/sync/binderImages.ts";
import { screenTitle } from "../../../app/documentTitle.ts";
import { showcaseItems, swipeStep, type ShowcaseItem } from "./showcaseItems.ts";
import { slotName } from "./pocketText.ts";
import styles from "./binder.module.css";

interface BinderShowcaseProps {
  binder: Binder;
  priceFor: (slot: BinderSlot) => number | undefined;
  pricesLoading: boolean;
  onClose: () => void;
  /** Where focus goes back to when the view closes: the button that opened it. */
  returnFocus: RefObject<HTMLElement | null>;
}

/**
 * "Show off": the binder, one large card at a time, for handing the phone to a
 * friend.
 *
 * A real modal, like `Sheet`: it covers the whole screen, so Tab must not walk
 * out into a binder nobody can see, and Escape is the way out. Local only — it
 * reads the binder it is given and writes nothing, so there is no server call
 * and no sync side to it.
 *
 * The tab says "Showcase" while it is open, because that is what is on screen;
 * the screen's own title comes back on close.
 */
export function BinderShowcase({
  binder,
  priceFor,
  pricesLoading,
  onClose,
  returnFocus,
}: BinderShowcaseProps) {
  const items = useMemo(() => showcaseItems(binder), [binder]);
  const [index, setIndex] = useState(0);
  /** Which way the last turn went, so the next card slides in from that side. */
  const [direction, setDirection] = useState<-1 | 1>(1);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const swipeFrom = useRef<{ x: number; y: number } | null>(null);
  const still = useMemo(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false, []);

  const at = Math.min(index, Math.max(0, items.length - 1));
  const count = items.length;

  const turn = (step: -1 | 0 | 1) => {
    if (step === 0) return;
    const next = Math.min(count - 1, Math.max(0, at + step));
    if (next === at) return;
    setDirection(step);
    setIndex(next);
  };
  // Read by the document listener through a ref, so it never goes stale.
  const turnRef = useRef(turn);
  const closeRef = useRef(onClose);
  useEffect(() => {
    turnRef.current = turn;
    closeRef.current = onClose;
  });

  useEffect(() => {
    const previousTitle = document.title;
    document.title = screenTitle("showcase");
    const back = returnFocus.current;
    dialogRef.current?.focus();
    return () => {
      document.title = previousTitle;
      back?.focus?.();
    };
  }, [returnFocus]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.stopPropagation();
        e.preventDefault();
        turnRef.current(e.key === "ArrowRight" ? 1 : -1);
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [],
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement;
      const inside = dialogRef.current?.contains(active) ?? false;
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const onPointerDown = (e: ReactPointerEvent) => {
    swipeFrom.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const from = swipeFrom.current;
    swipeFrom.current = null;
    if (!from) return;
    turn(swipeStep(e.clientX - from.x, e.clientY - from.y));
  };

  const item = items[at];

  return (
    <div
      className={styles.showcase}
      role="dialog"
      aria-modal="true"
      aria-label={`Showcase: ${binder.name}`}
      tabIndex={-1}
      ref={dialogRef}
    >
      <div className={styles.showHead}>
        <h2 className={styles.showTitle}>{binder.name}</h2>
        <button type="button" className={styles.button} onClick={onClose}>
          Close showcase
        </button>
      </div>

      {item ? (
        <>
          <div
            key={at}
            data-testid="showcase-stage"
            data-motion={still ? "still" : "slide"}
            className={cx(
              styles.showStage,
              !still && (direction > 0 ? styles.showFromRight : styles.showFromLeft),
            )}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              swipeFrom.current = null;
            }}
          >
            <ShowcaseCard item={item} price={priceFor(item.slot)} pricesLoading={pricesLoading} />
          </div>

          <nav aria-label="Showcase cards" className={styles.showFoot}>
            <button
              type="button"
              className={styles.button}
              onClick={() => turn(-1)}
              disabled={at === 0}
              aria-label="Previous card"
            >
              ‹ Previous
            </button>
            <span className={styles.hint} aria-live="polite">
              Card {at + 1} of {count}
            </span>
            <button
              type="button"
              className={styles.button}
              onClick={() => turn(1)}
              disabled={at >= count - 1}
              aria-label="Next card"
            >
              Next ›
            </button>
          </nav>
        </>
      ) : (
        <div className={styles.showEmpty}>
          <Panel title="Nothing to show off yet" headingLevel={2} tone="raised">
            <Stack gap={3}>
              <p>This binder has no cards in it. Choose a pocket to fill it, then show it off.</p>
              <div>
                <button type="button" className={styles.button} onClick={onClose}>
                  Back to the binder
                </button>
              </div>
            </Stack>
          </Panel>
        </div>
      )}
    </div>
  );
}

function ShowcaseCard({
  item,
  price,
  pricesLoading,
}: {
  item: ShowcaseItem;
  price: number | undefined;
  pricesLoading: boolean;
}) {
  const { slot, page } = item;
  const name = slotName(slot);
  const where = page === null ? "Cover" : `Page ${page}`;
  const meta =
    slot.kind === "card"
      ? [where, slot.collectorNumber ? `#${slot.collectorNumber}` : "", finishLabel(slot.finish)]
      : [where];

  return (
    <figure className={styles.showFigure}>
      <div className={styles.showArt}>
        {slot.kind === "card" ? (
          <CardArt src={slot.imageSmall} name={name} detail="hero" eager />
        ) : (
          <img className={styles.customArt} src={imageSlotSrc(slot)} alt={name} draggable={false} />
        )}
      </div>
      <figcaption className={styles.showCaption}>
        <span className={styles.showName}>{name}</span>
        <span className={styles.hint}>{meta.filter(Boolean).join(" · ")}</span>
        {slot.kind === "card" ? (
          <span className={styles.showPrice}>
            <Money value={price} loading={pricesLoading} absentLabel={UNPRICED} />
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
