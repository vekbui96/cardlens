import { useState } from "react";
import type { CollectFinish } from "../../../models/cards.ts";
import { Chip } from "../../primitives/index.ts";
import { asOwned } from "../addmany/applyPlan.ts";
import type { TradeLine } from "./summaryText.ts";
import styles from "./tradebuilder.module.css";
import { planTrade, type TradePlan } from "./tradeModel.ts";

type SetOwnedMany = (
  entries: { cardId: string; finish: CollectFinish; setId?: string; number?: string; owned: boolean }[],
) => void;

interface Props {
  give: readonly TradeLine[];
  get: readonly TradeLine[];
  isOwnedFinish: (cardId: string, finish: CollectFinish) => boolean;
  setOwnedMany: SetOwnedMany;
  /** Told once a trade is applied, so the screen can clear both sides. */
  onApplied?: () => void;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const label = (l: TradeLine): string => `${l.qty} x ${l.name} (${l.setName} ${l.collectorNumber})`;
const entries = (lines: readonly TradeLine[]) => lines.flatMap((l) => (l.entry ? [l.entry] : []));

/**
 * "Mark trade done": confirm what leaves and what arrives, apply it through the
 * same owned-card write Add many uses, then offer Undo. The collection holds a
 * printing as owned or not, so only printings that actually change are written
 * and Undo reverses exactly those. Undo is held in memory only.
 */
export function TradeDone({ give, get, isOwnedFinish, setOwnedMany, onApplied }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<TradePlan | null>(null);
  const ready = give.length > 0 || get.length > 0;

  const apply = () => {
    const plan = planTrade(entries(give), entries(get), isOwnedFinish);
    if (plan.remove.length > 0) setOwnedMany(asOwned(plan.remove, false));
    if (plan.add.length > 0) setOwnedMany(asOwned(plan.add, true));
    setDone(plan);
    setConfirming(false);
    onApplied?.();
  };
  const undo = () => {
    if (!done) return;
    if (done.add.length > 0) setOwnedMany(asOwned(done.add, false));
    if (done.remove.length > 0) setOwnedMany(asOwned(done.remove, true));
    setDone(null);
  };

  return (
    <div className={styles.actions}>
      {confirming ? (
        <div role="group" aria-label="Confirm trade done" className={styles.actions}>
          <p className={styles.total}>Mark this trade done?</p>
          <p className={styles.meta}>You give (leaves your collection):</p>
          <ul className={styles.meta} aria-label="Leaving your collection">
            {give.length === 0 ? <li>Nothing</li> : give.map((l, i) => <li key={`g${i}`}>{label(l)}</li>)}
          </ul>
          <p className={styles.meta}>You get (added to your collection):</p>
          <ul className={styles.meta} aria-label="Added to your collection">
            {get.length === 0 ? <li>Nothing</li> : get.map((l, i) => <li key={`r${i}`}>{label(l)}</li>)}
          </ul>
          <div className={styles.actionRow}>
            <Chip onPress={apply}>Confirm trade done</Chip>
            <Chip onPress={() => setConfirming(false)}>Cancel</Chip>
          </div>
        </div>
      ) : (
        <div className={styles.actionRow}>
          <Chip
            onPress={() => {
              setDone(null);
              setConfirming(true);
            }}
            disabled={!ready}
          >
            Mark trade done
          </Chip>
        </div>
      )}
      {done ? (
        <div className={styles.actionRow}>
          <p className={styles.meta} role="status">
            Trade done: {plural(done.remove.length, "card", "cards")} left your collection,{" "}
            {plural(done.add.length, "card", "cards")} added.
          </p>
          <Chip onPress={undo}>Undo</Chip>
        </div>
      ) : null}
    </div>
  );
}
