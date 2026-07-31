import { useEffect, useRef } from "react";
import { CardImage } from "../../components/CardImage.tsx";
import { finishLabel } from "../../models/finishes.ts";
import type { CollectFinish, PokemonCardSummary } from "../../models/cards.ts";
import { formatUsd } from "../../utils/format.ts";
import styles from "./CardSheet.module.css";

/**
 * Bottom sheet for one card: the art, and one row per printing to toggle.
 *
 * This is the web answer to the glasses' collect mode and printing picker. Both
 * exist there only because a pinch has to be told WHICH printing it means; with
 * a finger you tap the printing itself, so the mode and the picker are answering
 * a question that is not being asked.
 *
 * Deliberately not a route: it is a detail of the grid, and pushing a history
 * entry per card would bury the back gesture under a card the user only glanced
 * at. Escape and the backdrop both close it.
 */
export function CardSheet({
  card,
  finishes,
  owned,
  onToggle,
  onClose,
}: {
  card: PokemonCardSummary;
  finishes: CollectFinish[];
  owned: CollectFinish[];
  onToggle: (finish: CollectFinish) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Focus the panel so the sheet is reachable by keyboard and screen readers,
    // not only by touch.
    panel.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={styles.backdrop} onClick={onClose} role="presentation">
      <div
        ref={panel}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={card.name}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.grabber} aria-hidden="true" />
        <div className={styles.head}>
          <CardImage src={card.imageSmall} alt="" size="thumb" />
          <div className={styles.headText}>
            <h2 className={styles.name}>{card.name}</h2>
            <p className={styles.meta}>
              {card.collectorNumber}
              {card.rarity ? ` · ${card.rarity}` : ""}
            </p>
            <p className={styles.price}>{formatUsd(card.marketPrice)}</p>
          </div>
        </div>

        <ul className={styles.printings}>
          {finishes.map((finish) => {
            const held = owned.includes(finish);
            return (
              <li key={finish}>
                <button
                  type="button"
                  className={`${styles.printing} ${held ? styles.held : ""}`}
                  aria-pressed={held}
                  onClick={() => onToggle(finish)}
                >
                  <span className={styles.box} aria-hidden="true">
                    {held ? "✓" : ""}
                  </span>
                  <span className={styles.printingLabel}>{finishLabel(finish)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {/* Anything held that the set data does not list — a hand-marked pattern
            foil — must stay visible and removable, or it becomes unreachable. */}
        {owned.filter((f) => !finishes.includes(f)).length > 0 ? (
          <ul className={styles.printings}>
            {owned
              .filter((f) => !finishes.includes(f))
              .map((finish) => (
                <li key={finish}>
                  <button
                    type="button"
                    className={`${styles.printing} ${styles.held} ${styles.extra}`}
                    aria-pressed
                    onClick={() => onToggle(finish)}
                  >
                    <span className={styles.box} aria-hidden="true">
                      ✓
                    </span>
                    <span className={styles.printingLabel}>{finishLabel(finish)}</span>
                  </button>
                </li>
              ))}
          </ul>
        ) : null}

        <button type="button" className={styles.close} onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
