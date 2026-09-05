import { useId, useState } from "react";
import { useLibraryValue } from "../../../hooks/useLibraryValue.ts";
import { formatPct } from "../../../models/movement.ts";
import { Money, Panel, Row, Stack, cx } from "../../primitives/index.ts";
import { foldValue, setLabel, TOP_SETS } from "./valueFold.ts";
import styles from "./collection.module.css";

/**
 * What the collection is worth, per set.
 *
 * It goes through `useLibraryValue`, which is the ONLY place that builds
 * priceable rows from the live collection — so this panel and Home's headline
 * cannot drift into two different answers to "what is this worth". That hook
 * reaches `/api/catalog/prices` through `useCatalogPrices`, on the query key
 * `["catalog-prices", <sets>]`; asking for it any other way here would be a
 * second cache of the same answer and a second round of the requests it
 * replaced (19 calls at 4.5-6.7s each, several failing outright).
 *
 * The unpriced count sits next to the total rather than buried. Whole sets can
 * have no pricing upstream, and a total that quietly omits half the collection
 * while looking authoritative is worse than no total at all.
 */
export function ValuePanel() {
  const value = useLibraryValue();
  const [expanded, setExpanded] = useState(false);
  const listId = useId();

  /*
   * An empty collection gets a panel, not nothing.
   *
   * v1 returned null here, which is right on a screen that has other things to
   * say and wrong on a dashboard: the reader is left to work out whether the
   * total is missing because they own nothing or because it broke.
   */
  if (value.holdings === 0) {
    return (
      <Panel title="Value" headingLevel={2}>
        <p className={styles.muted}>
          Nothing marked owned yet. Open a set below and tap the printings you have — the total, and what is
          carrying it, appear here.
        </p>
      </Panel>
    );
  }

  const pricing = value.pending > 0;
  const fold = foldValue(value.bySet, value.setNames, expanded);
  const caption = pricing
    ? `pricing ${value.pending} ${value.pending === 1 ? "set" : "sets"}…`
    : `${value.priced} of ${value.printings} printings priced`;

  return (
    <Panel
      title="Value"
      headingLevel={2}
      aside={
        <span className={styles.caption} data-testid="pricing-progress">
          {caption}
        </span>
      }
    >
      <Stack gap={4}>
        <Row gap={3} align="baseline" wrap>
          <span className={styles.total}>
            <Money value={value.total} loading={pricing} absentLabel="No prices yet" />
          </span>
          {/*
            Movement is a percentage, never an amount: the series behind it is
            Cardmarket EUR while the total beside it is TCGplayer USD, and a
            percentage is the one figure that describes both without converting
            either.
          */}
          {value.movement.pct7 !== undefined ? (
            <span className={styles.movement}>
              <span className={value.movement.pct7 >= 0 ? styles.up : styles.down}>
                {formatPct(value.movement.pct7)}
              </span>
              <span className={styles.muted}>
                {" past week"}
                {value.movement.pct30 !== undefined ? ` · ${formatPct(value.movement.pct30)} past month` : ""}
              </span>
            </span>
          ) : null}
        </Row>

        {value.unpriced > 0 && !pricing ? (
          <p className={styles.note}>
            {value.unpriced} printing{value.unpriced === 1 ? "" : "s"} have no price upstream and are not
            counted.
          </p>
        ) : null}
        {value.failed > 0 ? (
          <p className={styles.note}>
            {value.failed} set{value.failed === 1 ? "" : "s"} could not be reached — the total is a lower
            bound, not a final figure.
          </p>
        ) : null}

        <ul className={styles.valueList} id={listId}>
          {fold.shown.map((s) => (
            <li key={s.setId} className={styles.valueRow}>
              <span className={styles.valueName}>{setLabel(s.setId, value.setNames)}</span>
              <span className={styles.valueCount}>
                {s.priced}/{s.printings}
              </span>
              <Money value={s.value} absentLabel="Unpriced" />
            </li>
          ))}
        </ul>

        {/*
          A BUTTON, never a hover: this is a disclosure, and a hover has no
          keyboard, no touch and no state a screen reader can report.

          Collapsed, it names and prices exactly what it is holding back. That
          is the point of it — the reader can decide whether to open it without
          opening it, which "12 more sets" cannot answer.
        */}
        {fold.hidden.length > 0 ? (
          <button
            type="button"
            className={styles.expander}
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <span className={styles.expanderLead}>Show the top {TOP_SETS} only</span>
            ) : (
              <>
                <span className={styles.expanderLead}>
                  {fold.hidden.length} more set{fold.hidden.length === 1 ? "" : "s"} ·{" "}
                  <Money value={fold.hiddenValue} absentLabel="no price yet" />
                </span>
                <span className={cx(styles.expanderNames, styles.muted)}>{fold.hiddenNames.join(", ")}</span>
              </>
            )}
          </button>
        ) : null}
      </Stack>
    </Panel>
  );
}
