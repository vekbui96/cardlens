import { RARITY_FILTERS } from "./rarityFilters.ts";
import styles from "./RarityBar.module.css";

/** Shows the rarity filter chips with the active one highlighted. Swipe ← → cycles. */
export function RarityBar({ activeKey }: { activeKey: string }) {
  return (
    <div className={styles.bar} role="tablist" aria-label="Rarity filter (swipe left or right)">
      <span className={styles.arrow} aria-hidden="true">
        ‹
      </span>
      <div className={styles.chips}>
        {RARITY_FILTERS.map((f) => {
          const on = f.key === activeKey;
          return (
            <span
              key={f.key}
              role="tab"
              aria-selected={on}
              className={`${styles.chip} ${on ? styles.chipOn : ""}`}
            >
              {f.short}
            </span>
          );
        })}
      </div>
      <span className={styles.arrow} aria-hidden="true">
        ›
      </span>
    </div>
  );
}
