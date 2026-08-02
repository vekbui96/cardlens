import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useSealed } from "../../hooks/useSealed.ts";
import { SEALED_KINDS } from "../../models/sealed.ts";
import { formatUsd } from "../../utils/format.ts";
import styles from "./WebSealedScreen.module.css";

/**
 * What sealed product costs right now, for the sets you collect.
 *
 * Web only. The figures are a grid of four columns across a dozen sets, which
 * is a table — and a table is the one thing a 600x600 additive display cannot
 * show, since every row of chrome there costs roughly two rows of list.
 *
 * Prices are TCGplayer market via tcgcsv, the same source and currency as every
 * card figure in the app, so a pack price and a card price can be compared
 * directly. See models/sealed.ts.
 */
export function WebSealedScreen() {
  const { push } = useNavigation();
  const { rows, pending, missing } = useSealed();

  return (
    <section className={styles.screen} aria-label="Sealed prices">
      <header className={styles.head}>
        <h2 className={styles.title}>Sealed prices</h2>
        <p className={styles.summary}>
          Pack and box prices for the {rows.length} {rows.length === 1 ? "set" : "sets"} you collect
          {pending > 0 ? ` · loading ${pending} more…` : ""}
        </p>
      </header>

      {rows.length === 0 && pending === 0 ? (
        <p className={styles.empty}>
          No sealed product found for your sets. Promos and tins are not sold in packs, so there is nothing
          upstream to price.
        </p>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => {
            const byKind = new Map(row.prices.map((p) => [p.kind, p]));
            return (
              <li key={row.setId} className={styles.card}>
                <button
                  type="button"
                  className={styles.setName}
                  onClick={() => push({ name: "set", setId: row.setId, setName: row.setName })}
                >
                  {row.setName}
                </button>
                <p className={styles.holdings}>
                  {row.holdings} printing{row.holdings === 1 ? "" : "s"} held
                </p>
                <dl className={styles.prices}>
                  {SEALED_KINDS.map((kind) => {
                    const found = byKind.get(kind.key);
                    return (
                      <div key={kind.key} className={styles.price}>
                        <dt className={styles.kind}>{kind.label}</dt>
                        {/*
                          A kind the set does not sell and a kind with no price
                          read differently on purpose: one is absent, the other
                          is unknown, and a single dash would merge them.
                        */}
                        <dd className={found?.price !== undefined ? styles.amount : styles.noAmount}>
                          {found === undefined
                            ? "not sold"
                            : found.price === undefined
                              ? "no price"
                              : formatUsd(found.price)}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </li>
            );
          })}
        </ul>
      )}

      {missing > 0 ? (
        <p className={styles.note}>
          {missing} of your sets {missing === 1 ? "has" : "have"} no sealed product upstream.
        </p>
      ) : null}
    </section>
  );
}
