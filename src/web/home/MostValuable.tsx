import { finishLabel } from "../../models/finishes.ts";
import type { OwnedPrintingRow } from "../../models/ownedSort.ts";
import { formatUsd } from "../../utils/format.ts";
import styles from "./MostValuable.module.css";

/**
 * The few printings carrying Home's total.
 *
 * The value card answers "what is it worth" with one number; this answers
 * "what is that number made of", so a chase card is one glance away and a price
 * that looks wrong is easy to spot. My cards sorted by price is the full list;
 * this is only its top, on the screen the question is asked from.
 *
 * Presentation only: the caller picks the rows (see `topByValue`) and decides
 * when they are final. An empty list renders nothing, never an empty heading.
 */
export function MostValuable({
  rows,
  onOpen,
}: {
  rows: OwnedPrintingRow[];
  onOpen: (row: OwnedPrintingRow) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <section className={styles.strip} aria-labelledby="home-most-valuable">
      <h2 id="home-most-valuable" className={styles.heading}>
        Most valuable
      </h2>
      <ol className={styles.list}>
        {rows.map((row) => (
          <li key={`${row.cardId}|${row.finish}`}>
            <button type="button" className={styles.card} onClick={() => onOpen(row)}>
              {/* A fixed box whether or not the art loads, as on My cards. */}
              <span className={styles.art}>
                {row.imageSmall ? <img src={row.imageSmall} alt="" loading="lazy" decoding="async" /> : null}
              </span>
              <span className={styles.name}>{row.name}</span>
              <span className={styles.meta}>
                {finishLabel(row.finish)} · {row.setName}
              </span>
              <span className={styles.price}>{formatUsd(row.price ?? 0)}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
