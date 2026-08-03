import { useEffect, useMemo, useRef } from "react";
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

/**
 * One printing row, shared by the known-printings list and the "extras" list
 * below it (a hand-marked finish the set data does not know about). `extra`
 * only changes the dashed border; held state and behaviour are identical.
 */
function PrintingRow({
  finish,
  held,
  excluded = false,
  extra = false,
  priceFor,
  onToggle,
  onToggleExcluded,
}: {
  finish: CollectFinish;
  held: boolean;
  /** Not part of this master set — a promo or box topper you will not chase. */
  excluded?: boolean;
  extra?: boolean;
  priceFor: (finish: CollectFinish) => number | undefined;
  onToggle: (finish: CollectFinish) => void;
  onToggleExcluded: (finish: CollectFinish) => void;
}) {
  return (
    <li className={styles.printingRow}>
      <button
        type="button"
        className={`${styles.printing} ${held ? styles.held : ""} ${extra ? styles.extra : ""} ${
          excluded ? styles.printingExcluded : ""
        }`}
        aria-pressed={held}
        disabled={excluded}
        onClick={() => onToggle(finish)}
      >
        <span className={styles.box} aria-hidden="true">
          {held ? "✓" : ""}
        </span>
        <span className={styles.printingLabel}>{finishLabel(finish)}</span>
        <span className={styles.printingPrice}>{excluded ? "not in set" : formatUsd(priceFor(finish))}</span>
      </button>
      {/*
       * Separate from the mark, because it answers a different question: not
       * "do I have this" but "does this belong in the set at all". TCGdex lists
       * every printing ever made, so promos and box toppers would otherwise
       * read as permanently missing and the completion figure would never be
       * reachable.
       */}
      <button
        type="button"
        className={styles.excludeToggle}
        aria-pressed={excluded}
        aria-label={`${excluded ? "Include" : "Exclude"} ${finishLabel(finish)}`}
        onClick={() => onToggleExcluded(finish)}
      >
        {excluded ? "Include" : "Exclude"}
      </button>
    </li>
  );
}

export function CardSheet({
  card,
  finishes,
  owned,
  headlinePrice,
  priceFor,
  onToggle,
  onToggleExcluded,
  excluded,
  onRemoveAll,
  onClose,
  storageDegraded = false,
}: {
  card: PokemonCardSummary;
  finishes: CollectFinish[];
  owned: CollectFinish[];
  /** The device is out of room and marks live in memory only. */
  storageDegraded?: boolean;
  /** Resolved by the caller from SetView.headlinePriceFor — the catalog price is not always the best one. */
  headlinePrice?: number;
  /** Price for one printing of THIS card. The caller binds the collector number. */
  priceFor: (finish: CollectFinish) => number | undefined;
  onToggle: (finish: CollectFinish) => void;
  /** Printings left out of the master set. */
  excluded: CollectFinish[];
  onToggleExcluded: (finish: CollectFinish) => void;
  /** Clear every held printing of this card in one action. */
  onRemoveAll: () => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);

  const ownedValue = useMemo(() => {
    let total: number | undefined;
    for (const finish of owned) {
      const price = priceFor(finish);
      if (price === undefined) continue;
      total = (total ?? 0) + price;
    }
    return total;
  }, [owned, priceFor]);

  /** A hand-marked finish the set data does not list — must stay visible and removable. */
  const extras = useMemo(() => owned.filter((f) => !finishes.includes(f)), [owned, finishes]);

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
        {/*
         * Done must stay reachable without scrolling, so only this wrapper
         * scrolls — the grabber, head and printing lists can run past the
         * sheet's max-height, but the close affordance below it never does.
         */}
        <div className={styles.scroll}>
          <div className={styles.grabber} aria-hidden="true" />
          <div className={styles.head}>
            <CardImage src={card.imageSmall} alt="" size="thumb" />
            <div className={styles.headText}>
              <h2 className={styles.name}>{card.name}</h2>
              <p className={styles.meta}>
                {card.collectorNumber}
                {card.rarity ? ` · ${card.rarity}` : ""}
              </p>
              <p className={styles.price} data-testid="sheet-headline-price">
                {formatUsd(headlinePrice)}
              </p>
            </div>
          </div>

          {/* Only what is actually held, and only when something priced is held:
              a "$0.00" line under an empty collection reads as a valuation, not
              as an absence. */}
          {ownedValue !== undefined ? (
            <p className={styles.ownedValue} data-testid="sheet-owned-value">
              You own {formatUsd(ownedValue)}
            </p>
          ) : null}

          {/* Shown where the marking happens, because that is the action it
              qualifies. Silence here is what made a full device look like an
              app ignoring taps. */}
          {storageDegraded ? (
            <p className={styles.storageWarning} role="status">
              This device is out of storage. Marks are kept in memory and still sync, but reload before they
              do and the newest ones are lost.
            </p>
          ) : null}

          <ul className={styles.printings}>
            {finishes.map((finish) => (
              <PrintingRow
                key={finish}
                finish={finish}
                held={owned.includes(finish)}
                excluded={excluded.includes(finish)}
                priceFor={priceFor}
                onToggle={onToggle}
                onToggleExcluded={onToggleExcluded}
              />
            ))}
          </ul>
          {/* Anything held that the set data does not list — a hand-marked pattern
              foil — must stay visible and removable, or it becomes unreachable. */}
          {extras.length > 0 ? (
            <ul className={styles.printings}>
              {extras.map((finish) => (
                <PrintingRow
                  key={finish}
                  finish={finish}
                  held
                  extra
                  priceFor={priceFor}
                  onToggle={onToggle}
                  onToggleExcluded={onToggleExcluded}
                />
              ))}
            </ul>
          ) : null}
          {/* Clearing a card one printing at a time is the common case done the
              slow way — a wrongly-scanned card can hold four. This removes them
              in one action, and only appears when there is something to remove
              so it never reads as a destructive button on an untouched card. */}
          {owned.length > 0 ? (
            <button type="button" className={styles.removeAll} onClick={onRemoveAll}>
              Remove {owned.length === 1 ? "this printing" : `all ${owned.length} printings`} from my
              collection
            </button>
          ) : null}
        </div>

        <button type="button" className={styles.close} onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
