import { useQueryClient } from "@tanstack/react-query";
import { Chip, Money, Panel, Row, Stack, cx } from "../../primitives/index.ts";
import { formatPct } from "../../../models/movement.ts";
import type { Movement } from "../../../models/movement.ts";
import { pricingSummary, type PricingInput } from "./homeSummary.ts";
import styles from "./Home.module.css";

/**
 * The headline number, and the denominator that keeps it honest.
 *
 * The total is never shown on its own. "$4,182.60" over a collection where two
 * sets could not be priced is a number that reads as complete and is not, and
 * there is nothing on the screen to tell the two apart — so the line underneath
 * always says how many of the printings the total actually covers.
 *
 * `Money` handles the other half: an unpriced collection is "Unavailable", not
 * `$0.00`, because a free card and an unpriced card are not the same card.
 */
export function ValuePanel({
  total,
  movement,
  pricing,
}: {
  total: number;
  movement: Movement;
  pricing: PricingInput;
}) {
  const client = useQueryClient();
  const summary = pricingSummary(pricing);

  /**
   * A retry, not a new request shape.
   *
   * Invalidating the two existing keys re-runs exactly the queries this screen
   * already depends on — one `/api/catalog/prices` for the whole collection,
   * and the per-set printings requests that were made anyway. Home's budget
   * says it may not ADD a per-set request; asking the same ones again after a
   * failure is what the budget is for.
   */
  const retry = () => {
    void client.invalidateQueries({ queryKey: ["catalog-prices"] });
    void client.invalidateQueries({ queryKey: ["printings-value"] });
  };

  return (
    <Panel
      title="Collection value"
      headingLevel={2}
      tone="raised"
      aside={
        <a className={styles.aside} href="#/collection">
          Breakdown by set
        </a>
      }
    >
      <Stack gap={3}>
        <Row gap={3} align="baseline" wrap>
          <span className={styles.total}>
            <Money value={total} loading={summary.loading} />
          </span>
          {/*
            A percentage, not an amount: the movement series is Cardmarket EUR
            while the total is TCGplayer USD, and a percentage is the only form
            that can describe one with the other — see models/movement.ts. The
            sign carries the direction, so this needs no colour.
          */}
          {movement.pct7 !== undefined ? <Chip>{formatPct(movement.pct7)} over 7 days</Chip> : null}
        </Row>

        <p className={cx(styles.line, summary.warn && styles.lineWarn)}>{summary.line}</p>

        {summary.cannotPrice.length > 0 ? (
          <p className={styles.note}>
            No price for <span className={styles.noteSets}>{summary.cannotPrice.join(", ")}</span>
            {summary.cannotPrice.length === 1 ? " — it is" : " — they are"} left out of the total rather than
            counted as nothing.
          </p>
        ) : null}

        {summary.retryable ? (
          <Row gap={2} wrap>
            <Chip onPress={retry}>Try pricing again</Chip>
          </Row>
        ) : null}
      </Stack>
    </Panel>
  );
}
