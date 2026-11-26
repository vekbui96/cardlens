import { useState } from "react";
import { useOwnedCards } from "../../../hooks/useOwnedCards.ts";
import { formatPct } from "../../../models/movement.ts";
import { Money, Panel, Stack } from "../../primitives/index.ts";
import { balance, type SideTotal } from "./balanceModel.ts";
import { GetSide } from "./GetSide.tsx";
import { GiveSide } from "./GiveSide.tsx";
import styles from "./tradebuilder.module.css";

const NONE: SideTotal = { total: 0, cards: 0, unpriced: 0 };

/**
 * Trade builder: the "I give" side, the "I get" side and the balance between
 * them. Nothing is saved and no cards move.
 */
export function TradeBuilderScreen() {
  // No backfill: opening a screen that only reads must not write to the collection.
  const { rows, pending, pricing } = useOwnedCards({ backfill: false });
  const [give, setGive] = useState<SideTotal>(NONE);
  const [get, setGet] = useState<SideTotal>(NONE);
  return (
    <Stack gap={5}>
      <header>
        <h1 className={styles.title}>Trade</h1>
        <p className={styles.meta}>Work out a trade from the cards you own.</p>
      </header>
      <GiveSide rows={rows} loading={pending + pricing} onTotal={setGive} />
      <GetSide onTotal={setGet} />
      <BalanceLine give={give} get={get} />
    </Stack>
  );
}

function BalanceLine({ give, get }: { give: SideTotal; get: SideTotal }) {
  const empty = give.cards === 0 && get.cards === 0;
  const b = balance(give.total, get.total);
  const unpriced = give.unpriced + get.unpriced;
  return (
    <Panel title="Balance" headingLevel={2}>
      <Stack gap={2}>
        <p className={styles.total} data-testid="balance">
          {empty ? (
            <span>Add cards to both sides to see the balance.</span>
          ) : give.total === 0 && get.total === 0 ? (
            <span>No prices yet, so there is nothing to compare.</span>
          ) : b.lean === "even" ? (
            <span>Even: both sides are worth the same.</span>
          ) : (
            <>
              <span>{b.lean === "get" ? "You get " : "You give "}</span>
              <Money value={b.diff} />
              <span> more ({formatPct(b.percent).replace("+", "")} of the larger side)</span>
            </>
          )}
        </p>
        {unpriced > 0 ? (
          <p className={styles.meta} data-testid="balance-unpriced">
            {give.unpriced > 0 ? `${give.unpriced} unpriced on your side` : ""}
            {give.unpriced > 0 && get.unpriced > 0 ? "; " : ""}
            {get.unpriced > 0 ? `${get.unpriced} unpriced on theirs` : ""}, not counted. Prices are in USD.
          </p>
        ) : null}
      </Stack>
    </Panel>
  );
}
