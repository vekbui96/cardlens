import { useEffect, useRef } from "react";
import type { CollectFinish } from "../../models/cards.ts";
import { finishLabel, finishShort } from "../../models/finishes.ts";
import styles from "./FinishBar.module.css";

/**
 * The printing a pinch will mark, as a row of chips at the top of the set list.
 *
 * Mirrors RarityBar, but focusable and selectable rather than swipe-only. The
 * swipe still works and is faster once known — this exists because a gesture
 * that changes what every subsequent pinch does is invisible until someone
 * discovers it, and on glasses there is nothing to hover or read.
 */
export function FinishBar({
  choices,
  active,
  focused,
  onActivate,
}: {
  choices: readonly CollectFinish[];
  active: CollectFinish;
  focused: boolean;
  onActivate: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "nearest" });
  }, [focused]);

  return (
    <button
      ref={ref}
      type="button"
      className={`${styles.bar} ${focused ? styles.focused : ""}`}
      aria-label={`Printing to mark: ${finishLabel(active)}. Select or swipe to change.`}
      aria-selected={focused}
      onClick={onActivate}
    >
      <span className={styles.arrow} aria-hidden="true">
        ‹
      </span>
      <span className={styles.chips}>
        {choices.map((finish) => {
          const on = finish === active;
          return (
            <span key={finish} className={`${styles.chip} ${on ? styles.chipOn : ""}`} aria-hidden="true">
              {finishShort(finish)}
            </span>
          );
        })}
      </span>
      <span className={styles.arrow} aria-hidden="true">
        ›
      </span>
    </button>
  );
}
