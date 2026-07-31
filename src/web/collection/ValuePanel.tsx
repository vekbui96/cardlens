import { useMemo } from "react";
import { useLibrary } from "../../app/LibraryProvider.tsx";
import { useSets } from "../../hooks/useSets.ts";
import { useCollectionValue } from "../../hooks/useCollectionValue.ts";
import type { ValuableRow } from "../../models/value.ts";
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
export function ValuePanel() {
  const { collection } = useLibrary();
  const { data: sets } = useSets();

  const rows = useMemo<ValuableRow[]>(
    () =>
      collection.flatMap((card) =>
        card.finishes.map((finish) => ({
          cardId: card.id,
          setId: card.setId ?? card.id.slice(0, card.id.lastIndexOf("-")),
          finish,
        })),
      ),
    [collection],
  );

  const setNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const s of sets ?? []) names[s.id] = s.name;
    return names;
  }, [sets]);

  const value = useCollectionValue(rows, setNames);

  if (rows.length === 0) return null;

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

      <ul className={styles.sets}>
        {value.bySet.map((s) => (
          <li key={s.setId} className={styles.set}>
            <span className={styles.setName}>{setNames[s.setId] ?? s.setId}</span>
            <span className={styles.setMeta}>
              {s.priced}/{s.printings}
            </span>
            <span className={styles.setValue}>{formatUsd(s.value)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
