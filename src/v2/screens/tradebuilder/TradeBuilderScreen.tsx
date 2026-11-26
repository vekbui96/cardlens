import { useOwnedCards } from "../../../hooks/useOwnedCards.ts";
import { Stack } from "../../primitives/index.ts";
import { GiveSide } from "./GiveSide.tsx";
import styles from "./tradebuilder.module.css";

/**
 * Trade builder, slice 1: the screen and the "I give" side. The "I get" side
 * and the balance come in a later slice; nothing is saved and no cards move.
 */
export function TradeBuilderScreen() {
  // No backfill: opening a screen that only reads must not write to the collection.
  const { rows, pending, pricing } = useOwnedCards({ backfill: false });
  return (
    <Stack gap={5}>
      <header>
        <h1 className={styles.title}>Trade</h1>
        <p className={styles.meta}>Work out a trade from the cards you own.</p>
      </header>
      <GiveSide rows={rows} loading={pending + pricing} />
    </Stack>
  );
}
