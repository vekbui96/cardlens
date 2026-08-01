import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useLibrary } from "../../app/LibraryProvider.tsx";
import { useSets } from "../../hooks/useSets.ts";
import { useSearchAction } from "../../features/search/useSearchAction.ts";
import { continueTarget, topProgress } from "../../features/home/continueSet.ts";
import { useLibraryValue } from "../../hooks/useLibraryValue.ts";
import { formatPct } from "../../models/movement.ts";
import { formatUsd } from "../../utils/format.ts";
import styles from "./WebHomeScreen.module.css";

/**
 * Home, for a browser.
 *
 * The glasses Home is a menu, and has to be: four gestures and a focus ring make
 * a fixed, memorised list the only workable way to reach anything, which is why
 * that screen never reorders itself.
 *
 * On web those same destinations live in the app bar, one tap from everywhere.
 * Repeating them down the middle of the page would make Home a worse copy of a
 * menu the user already has. So Home answers the question the menu cannot:
 * where did I get to, and how far through am I.
 */
export function WebHomeScreen() {
  const { push } = useNavigation();
  const { collection, ownedCountsBySet, ownedFinishCountsBySet, totalFinishesOwned, finishesBySet } =
    useLibrary();
  const { data: sets } = useSets();
  const { typeSearch } = useSearchAction();
  const value = useLibraryValue();

  const resume = continueTarget(collection, sets, ownedCountsBySet, ownedFinishCountsBySet);
  const progress = topProgress(ownedCountsBySet, sets);
  const setCount = Object.keys(ownedCountsBySet).length;

  return (
    /*
     * A plain section, not Screen: Screen renders the app name as an <h1>, and
     * the app bar already carries it. Two "CardLens" headings stacked is the
     * kind of duplication that appears the moment a shell grows chrome the
     * screens were written without.
     */
    <section className={styles.screen} aria-label="Home">
      {collection.length === 0 ? (
        // Nothing tracked yet: an empty dashboard is a dead end, so this is the
        // one case where Home offers a way in rather than a status.
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Nothing tracked yet</p>
          <p className={styles.emptyHint}>
            Open a set and tap the printings you own, or search for a card to start.
          </p>
          <div className={styles.emptyActions}>
            <button type="button" className={styles.primary} onClick={() => push({ name: "sets" })}>
              Browse sets
            </button>
            <button type="button" className={styles.secondary} onClick={() => void typeSearch()}>
              Search
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className={styles.stats}>
            <span className={styles.statNumber}>{collection.length}</span> cards ·{" "}
            <span className={styles.statNumber}>{totalFinishesOwned}</span> printings ·{" "}
            <span className={styles.statNumber}>{setCount}</span> {setCount === 1 ? "set" : "sets"}
          </p>

          {/*
            The headline number, and a tap through to the per-set breakdown.
            Movement is a percentage because the series behind it is Cardmarket
            EUR while the total is TCGplayer USD -- see models/movement.ts.
          */}
          <button
            type="button"
            className={styles.value}
            onClick={() => push({ name: "collection" })}
            aria-label="Collection value, open collection"
          >
            <span className={styles.valueLabel}>Collection value</span>
            <span className={styles.valueRow}>
              <span className={styles.valueTotal}>{formatUsd(value.total)}</span>
              {value.movement.pct7 !== undefined ? (
                <span className={value.movement.pct7 >= 0 ? styles.up : styles.down}>
                  {formatPct(value.movement.pct7)}
                  <span className={styles.valueWindow}> 7d</span>
                </span>
              ) : null}
            </span>
            <span className={styles.valueMeta}>
              {value.pending > 0
                ? `pricing ${value.pending} set${value.pending === 1 ? "" : "s"}…`
                : `${value.priced} of ${value.printings} printings priced`}
            </span>
          </button>

          {resume ? (
            <button
              type="button"
              className={styles.resume}
              onClick={() => push({ name: "set", setId: resume.setId, setName: resume.setName })}
            >
              <span className={styles.resumeLabel}>Pick up where you left off</span>
              <span className={styles.resumeName}>{resume.setName}</span>
              <span className={styles.resumeMeta}>
                {resume.total ? `${resume.cards}/${resume.total} cards` : `${resume.cards} cards`} ·{" "}
                {resume.printings} printings
              </span>
            </button>
          ) : null}

          {progress.length > 0 ? (
            <>
              <h2 className={styles.group}>Closest to complete</h2>
              <ul className={styles.list}>
                {progress.map((row) => {
                  const pct = row.ratio !== undefined ? Math.round(row.ratio * 100) : null;
                  const printings = ownedFinishCountsBySet[row.setId] ?? row.cards;
                  const finishes = Object.keys(finishesBySet[row.setId] ?? {}).length;
                  return (
                    <li key={row.setId}>
                      <button
                        type="button"
                        className={styles.row}
                        onClick={() => push({ name: "set", setId: row.setId, setName: row.setName })}
                      >
                        <span className={styles.rowName}>{row.setName}</span>
                        <span className={styles.rowMeta}>
                          {printings} printings
                          {finishes > 1 ? ` · ${finishes} finishes` : ""}
                        </span>
                        <span className={styles.rowProgress}>
                          {pct !== null ? (
                            <span className={`${styles.bar} ${pct === 100 ? styles.barDone : ""}`}>
                              <span className={styles.fill} style={{ width: `${pct}%` }} />
                            </span>
                          ) : null}
                          <span className={`${styles.pct} ${pct === 100 ? styles.pctDone : ""}`}>
                            {row.total ? `${row.cards}/${row.total}` : `${row.cards}`}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
