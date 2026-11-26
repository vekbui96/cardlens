import { useEffect, useMemo, useState } from "react";
import type { SideTotal } from "./balanceModel.ts";
import { finishLabel } from "../../../models/finishes.ts";
import type { OwnedPrintingRow } from "../../../models/ownedSort.ts";
import { CardArt, Money, Panel, Stack, UNPRICED } from "../../primitives/index.ts";
import {
  addChoice,
  giveKey,
  giveLines,
  giveTotal,
  matchRows,
  removeChoice,
  setChoiceQty,
  type GiveChoice,
} from "./giveModel.ts";
import type { TradeLine } from "./summaryText.ts";
import styles from "./tradebuilder.module.css";

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Most search results shown at once. */
const MAX_RESULTS = 8;

interface Props {
  /** Every printing owned, with names and prices (`useOwnedCards`). */
  rows: readonly OwnedPrintingRow[];
  /** Sets whose names or prices are still on the way. */
  loading: number;
  /** Told the side's totals whenever they change, for the balance line. */
  onTotal?: (total: SideTotal) => void;
  /** Told the chosen cards whenever they change, for the copy and image summary. */
  onLines?: (lines: TradeLine[]) => void;
}

/**
 * The "I give" side: search the cards you own, tap one to add it, set how many,
 * and see what the side adds up to. Held in state only, so a reload clears it.
 */
export function GiveSide({ rows, loading, onTotal, onLines }: Props) {
  const [choices, setChoices] = useState<GiveChoice[]>([]);
  const [query, setQuery] = useState("");

  const lines = useMemo(() => giveLines(choices, rows), [choices, rows]);
  const { total, cards, unpriced } = useMemo(() => giveTotal(lines), [lines]);
  useEffect(() => onTotal?.({ total, cards, unpriced }), [onTotal, total, cards, unpriced]);
  useEffect(
    () =>
      onLines?.(
        lines.map((l) => ({
          name: l.row.name,
          setName: l.row.setName,
          collectorNumber: l.row.collectorNumber,
          qty: l.qty,
          price: l.row.price,
        })),
      ),
    [onLines, lines],
  );
  const results = useMemo(() => {
    const chosen = new Set(choices.map((c) => giveKey(c.cardId, c.finish)));
    return matchRows(rows, query)
      .filter((r) => !chosen.has(giveKey(r.cardId, r.finish)))
      .slice(0, MAX_RESULTS);
  }, [rows, query, choices]);

  return (
    <Panel title="I give" headingLevel={2}>
      <Stack gap={4}>
        {lines.length === 0 ? (
          <p className={styles.meta} data-testid="give-empty">
            The Trade builder works out what a trade is worth. Start with the cards you would give: pick them
            from your collection and see their total.
          </p>
        ) : null}

        <div>
          <label htmlFor="give-search" className={styles.label}>
            Add a card you would give
          </label>
          <input
            id="give-search"
            type="search"
            className={styles.field}
            value={query}
            placeholder="Search your cards by name"
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {rows.length === 0 && loading === 0 ? (
          <p className={styles.meta}>
            You do not own any cards yet. Mark cards as owned and they show up here.
          </p>
        ) : null}
        {query.trim() !== "" && results.length === 0 && loading === 0 ? (
          <p className={styles.meta}>No card you own matches that.</p>
        ) : null}

        {results.length > 0 ? (
          <ul className={styles.list} aria-label="Cards you own">
            {results.map((r) => (
              <li key={giveKey(r.cardId, r.finish)}>
                <button
                  type="button"
                  className={styles.pick}
                  aria-label={`Add ${r.name}, ${finishLabel(r.finish)}, ${r.setName} ${r.collectorNumber}`}
                  onClick={() => setChoices((c) => addChoice(c, r.cardId, r.finish))}
                >
                  <Line row={r} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {lines.length > 0 ? (
          <>
            <ul className={styles.list} aria-label="Cards you give" data-testid="give-list">
              {lines.map((l) => (
                <li key={l.key} className={styles.chosen}>
                  <Line row={l.row} />
                  <div className={styles.controls}>
                    <button
                      type="button"
                      className={styles.step}
                      aria-label={`Fewer ${l.row.name}`}
                      disabled={l.qty <= 1}
                      onClick={() =>
                        setChoices((c) => setChoiceQty(c, l.row.cardId, l.row.finish, l.qty - 1, l.owned))
                      }
                    >
                      −
                    </button>
                    <span className={styles.qty} aria-label={`${l.qty} of ${l.owned} owned`}>
                      {l.qty}
                    </span>
                    <button
                      type="button"
                      className={styles.step}
                      aria-label={`More ${l.row.name}`}
                      disabled={l.qty >= l.owned}
                      onClick={() =>
                        setChoices((c) => setChoiceQty(c, l.row.cardId, l.row.finish, l.qty + 1, l.owned))
                      }
                    >
                      +
                    </button>
                    <button
                      type="button"
                      className={styles.remove}
                      aria-label={`Remove ${l.row.name}`}
                      onClick={() => setChoices((c) => removeChoice(c, l.row.cardId, l.row.finish))}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <p className={styles.total} data-testid="give-total">
              <span>{plural(cards, "card", "cards")} · </span>
              {total > 0 ? <Money value={total} /> : <span>No price yet</span>}
              {unpriced > 0 ? <span> · {unpriced} unpriced, left out of the total</span> : null}
              {loading > 0 ? <span> · still pricing</span> : null}
            </p>
          </>
        ) : null}
      </Stack>
    </Panel>
  );
}

function Line({ row }: { row: OwnedPrintingRow }) {
  return (
    <span className={styles.row}>
      <span className={styles.art}>
        <CardArt src={row.imageSmall} name={row.name} detail="tile" decorative />
      </span>
      <span className={styles.text}>
        <span className={styles.name}>{row.name}</span>
        <span className={styles.detail}>
          {finishLabel(row.finish)} · {row.setName} {row.collectorNumber}
        </span>
      </span>
      <span className={styles.price} data-testid="give-price">
        <Money value={row.price} absentLabel={UNPRICED} />
      </span>
    </span>
  );
}
