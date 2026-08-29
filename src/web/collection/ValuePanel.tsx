import { useId, useState } from "react";
import { useLibraryValue } from "../../hooks/useLibraryValue.ts";
import { formatPct } from "../../models/movement.ts";
import { formatUsd } from "../../utils/format.ts";
import styles from "./ValuePanel.module.css";

/**
 * What the collection is worth, per set.
 *
 * Web only. It needs a table's worth of numbers and a scroll, neither of which
 * fits a 600x600 additive display where every row of chrome costs two rows of
 * list — the glasses Collection screen stays a progress list.
 *
 * The unpriced count is shown next to the total rather than buried. Whole sets
 * can have no pricing upstream, and a total that quietly omits half the
 * collection while looking authoritative is worse than no total at all.
 */
/**
 * Sets shown before the panel asks to be expanded.
 *
 * Five, because this panel answers "what is it worth, and what is carrying it",
 * and past the fifth set the tail is a long run of small numbers that answers
 * neither. It is not a scrolling limit — the whole list is one tap away.
 */
const TOP_SETS = 5;

export function ValuePanel() {
  const value = useLibraryValue();
  const setNames = value.setNames;
  const [expanded, setExpanded] = useState(false);
  const listId = useId();

  const shown = expanded ? value.bySet : value.bySet.slice(0, TOP_SETS);
  const hidden = value.bySet.slice(TOP_SETS);
  const hiddenValue = hidden.reduce((sum, s) => sum + s.value, 0);
  const movement7 = value.movement.pct7;
  const movement30 = value.movement.pct30;

  if (value.holdings === 0) return null;

  return (
    <section className={styles.panel} aria-label="Collection value">
      <div className={styles.headline}>
        <span className={styles.total}>{formatUsd(value.total)}</span>
        <span className={styles.caption}>
          {value.pending > 0
            ? `pricing ${value.pending} set${value.pending === 1 ? "" : "s"}…`
            : `${value.priced} of ${value.printings} printings priced`}
        </span>
      </div>
      {/*
        Movement is a percentage, never an amount: the series behind it is
        Cardmarket EUR while the total above is TCGplayer USD, and a percentage
        is the one figure that describes both without converting either.
      */}
      {movement7 !== undefined ? (
        <div className={styles.movement} data-testid="movement">
          <span className={movement7 >= 0 ? styles.up : styles.down}>{formatPct(movement7)}</span>
          <span className={styles.movementLabel}>
            past week
            {movement30 !== undefined ? ` · ${formatPct(movement30)} past month` : ""}
          </span>
        </div>
      ) : null}
      {value.unpriced > 0 && value.pending === 0 ? (
        <p className={styles.note}>
          {value.unpriced} printing{value.unpriced === 1 ? "" : "s"} have no price upstream and are not
          counted.
        </p>
      ) : null}
      {value.failed > 0 ? (
        <p className={styles.note}>
          {value.failed} set{value.failed === 1 ? "" : "s"} could not be priced — the total is a lower bound.
        </p>
      ) : null}
      {/*
        The five most valuable sets, and the rest on request.
        
        `bySet` is every set the collection touches — nineteen for this one —
        and printing all of them pushed the set-progress list, which is what
        this screen is actually for, most of a phone screen down. Five is where
        the answer to "what is my collection worth, and what is carrying it"
        stops changing: the tail is a long run of small numbers.
      */}
      <ul className={styles.sets} id={listId}>
        {shown.map((s) => (
          <li key={s.setId} className={styles.set}>
            <span className={styles.setName}>{setNames[s.setId] ?? s.setId}</span>
            <span className={styles.setMeta}>
              {s.priced}/{s.printings}
            </span>
            <span className={styles.setValue}>{formatUsd(s.value)}</span>
          </li>
        ))}
      </ul>
      {/*
        The remainder is named and priced rather than merely hidden. A "show
        more" that does not say what is behind it makes the reader open it to
        find out whether they needed to — and this panel's whole discipline is
        that a total never quietly omits part of itself.
      */}
      {value.bySet.length > TOP_SETS ? (
        <button
          type="button"
          className={styles.more}
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded
            ? `Show top ${TOP_SETS}`
            : `${hidden.length} more set${hidden.length === 1 ? "" : "s"} · ${formatUsd(hiddenValue)}`}
        </button>
      ) : null}{" "}
    </section>
  );
}
