import type { CollectFinish } from "../../models/cards.ts";
import { FinishBreakdown } from "./FinishBreakdown.tsx";
import styles from "./SetProgressRow.module.css";

/** One set's completion: name, owned/total, and a bar. */
export function SetProgressRow({
  name,
  owned,
  printings,
  finishes,
  total,
  ratio,
}: {
  name: string;
  owned: number;
  printings: number;
  finishes: Partial<Record<CollectFinish, number>>;
  total?: number;
  ratio?: number;
}) {
  const percent = ratio === undefined ? undefined : Math.round(ratio * 100);
  const complete = ratio === 1;

  return (
    <div className={styles.row}>
      <div className={styles.head}>
        <span className={styles.name}>
          {complete ? <span className={styles.star}>★ </span> : null}
          {name}
        </span>
        <span className={styles.count}>{total ? `${owned}/${total}` : `${owned}`}</span>
      </div>
      {/* The bar is decorative; the counts above carry the same information for
          screen readers, so it is hidden from the accessibility tree. */}
      <div className={styles.track} aria-hidden="true">
        <div
          className={`${styles.fill} ${complete ? styles.fillComplete : ""}`}
          style={{ width: `${percent ?? 0}%` }}
        />
      </div>
      <div className={styles.footer}>
        <span className={styles.percent}>
          {percent === undefined ? "" : `${percent}%`}
          {/* Only worth showing once it diverges from the card count — otherwise
              it is the same number twice. */}
          {printings > owned ? `${percent === undefined ? "" : " · "}${printings} printings` : ""}
        </span>
        <FinishBreakdown counts={finishes} />
      </div>
    </div>
  );
}
