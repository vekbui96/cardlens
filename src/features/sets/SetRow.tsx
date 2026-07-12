import type { PokemonSet } from "../../models/cards.ts";
import styles from "./SetRow.module.css";

export function SetRow({ set }: { set: PokemonSet }) {
  const year = set.releaseDate ? set.releaseDate.slice(0, 4) : "";
  return (
    <div className={styles.row}>
      <div className={styles.info}>
        <div className={styles.name}>{set.name}</div>
        <div className={styles.meta}>
          {set.series ? `${set.series}` : ""}
          {set.series && year ? " · " : ""}
          {year}
        </div>
      </div>
      {typeof set.total === "number" ? <div className={styles.total}>{set.total} cards</div> : null}
    </div>
  );
}
