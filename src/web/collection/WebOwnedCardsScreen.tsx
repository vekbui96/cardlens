import { useMemo, useState } from "react";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useOwnedCards } from "../../hooks/useOwnedCards.ts";
import { finishLabel } from "../../models/finishes.ts";
import { OWNED_SORTS, sortOwned, totalOf, type OwnedSortKey } from "../../models/ownedSort.ts";
import { formatUsd } from "../../utils/format.ts";
import styles from "./WebOwnedCardsScreen.module.css";

/**
 * Every printing you own, as one flat list you can reorder.
 *
 * Web only. The Collection screen answers "how far through each set am I" —
 * a per-set progress list, which is the right shape for a 600x600 additive
 * display where every row of chrome costs two rows of list. It cannot answer
 * "what is the single most valuable thing I own", because that question crosses
 * sets and needs a sort control, a price column and a scroll.
 *
 * Rows are printings, not cards: a card held in normal and reverse is two rows,
 * because they are two things with two prices and you own both.
 */
export function WebOwnedCardsScreen() {
  const { push } = useNavigation();
  const { rows, pending } = useOwnedCards();
  const [sort, setSort] = useState<OwnedSortKey>("price");

  const sorted = useMemo(() => sortOwned(rows, sort), [rows, sort]);
  const { total, unpriced } = useMemo(() => totalOf(rows), [rows]);

  return (
    <section className={styles.screen} aria-label="My cards">
      <header className={styles.head}>
        <h2 className={styles.title}>My cards</h2>
        {/*
          The total appears only once there is one. formatUsd renders a
          non-positive figure as "Unavailable", which is right for one card and
          wrong here: a running total of zero means nothing has priced yet, and
          saying so in the money slot reads as a failure rather than progress.
        */}
        <p className={styles.summary}>
          <span className={styles.count}>{rows.length}</span> printings
          {total > 0 ? (
            <>
              {" · "}
              <span className={styles.total}>{formatUsd(total)}</span>
            </>
          ) : null}
          {pending > 0 ? (
            <span className={styles.pending}> · pricing {pending === 1 ? "1 set" : `${pending} sets`}…</span>
          ) : unpriced > 0 ? (
            <span className={styles.pending}> · {unpriced} unpriced</span>
          ) : null}
        </p>
      </header>

      {/*
        A row of buttons rather than a <select>: there are four options, they all
        fit, and the current one should be readable without opening anything.
      */}
      <div className={styles.sorts} role="group" aria-label="Sort by">
        {OWNED_SORTS.map((s) => (
          <button
            key={s.key}
            type="button"
            className={`${styles.sort} ${s.key === sort ? styles.sortOn : ""}`}
            aria-pressed={s.key === sort}
            onClick={() => setSort(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className={styles.empty}>Nothing marked owned yet. Open a set and tap the printings you have.</p>
      ) : (
        <ul className={styles.list}>
          {sorted.map((row) => (
            <li key={`${row.cardId}|${row.finish}`}>
              <button
                type="button"
                className={styles.row}
                onClick={() => push({ name: "details", cardId: row.cardId })}
              >
                {/*
                  Fixed aspect box whether or not the art loads. Sizing a tile
                  from the image alone collapsed it to 19px when upstream 404'd.
                */}
                <span className={styles.art}>
                  {row.imageSmall ? (
                    <img src={row.imageSmall} alt="" loading="lazy" decoding="async" />
                  ) : null}
                </span>
                <span className={styles.name}>{row.name}</span>
                {/*
                  Finish first, set last. Two rows of the same card differ only
                  by finish, so it is the one field that must survive the
                  ellipsis on a narrow phone — with the set leading, a pair of
                  Charizards truncated to "Obsidian Flames · 125 · R…" and
                  "… · N…", which is the only part that told them apart.
                */}
                <span className={styles.meta}>
                  {finishLabel(row.finish)} · {row.setName} {row.collectorNumber}
                </span>
                {/*
                  No price is not a zero price: pattern foils are routinely
                  absent upstream, and printing "$0.00" would claim they are
                  worthless rather than unknown.
                */}
                <span className={row.price === undefined ? styles.noPrice : styles.price}>
                  {row.price === undefined ? "unpriced" : formatUsd(row.price)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
