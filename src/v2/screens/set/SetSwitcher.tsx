import { useState } from "react";
import { Card, Meter, Sheet, Stack } from "../../primitives/index.ts";
import { useNavigation } from "../../../app/NavigationProvider.tsx";
import { useCollectedSets } from "../../../hooks/useCollectedSets.ts";
import { setTiers } from "../../../models/setCompletion.ts";
import { shownRatio, tierLabel } from "../../../features/collection/completionTier.ts";
import styles from "./set.module.css";

/**
 * The set name, as a switcher.
 *
 * Master-setting is not one set at a time — a real collection runs to nineteen
 * of them, and moving between two used to mean back, scroll the set list, tap.
 * The name at the top of the screen is already the answer to "which set is
 * this", so it is the honest place to hang "and which else".
 *
 * The list is the sets you own cards from, in the order `useCollectedSets`
 * ranks them (closest to complete first) rather than alphabetically: the set you
 * are nearly done with is the set you are working on. Sets you have not started
 * are one tap further on, through All sets — putting 217 of them here would bury
 * the handful that matter.
 *
 * A `Sheet` at both widths, not a `RailHost`. A rail is for content you want
 * beside the page while you work; this is a destination picker you use once and
 * dismiss, and leaving it open would cost the pockets a third of the window.
 */
export function SetSwitcher({ setId, setName }: { setId: string; setName: string }) {
  const { replace, push } = useNavigation();
  const collected = useCollectedSets();
  const [open, setOpen] = useState(false);

  // The set being viewed always appears, even at zero owned: opening a set from
  // the full list and finding it missing from its own switcher reads as a bug.
  const sets = collected.some((s) => s.setId === setId)
    ? collected
    : [{ setId, setName, owned: 0, printings: 0, finishes: {}, tiers: setTiers({}, 0) }, ...collected];

  const go = (id: string, name: string) => {
    setOpen(false);
    if (id === setId) return;
    // Replace, not push: switching sets is a lateral move. Pushing would make
    // Back walk every set visited instead of leaving for where you came from.
    replace({ name: "set", setId: id, setName: name });
  };

  return (
    <>
      <h1 className={styles.title}>
        <button
          type="button"
          className={styles.titleButton}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`${setName}. Switch set`}
          onClick={() => setOpen(true)}
        >
          <span>{setName}</span>
          <span className={styles.caret} aria-hidden="true">
            ▾
          </span>
        </button>
      </h1>

      <Sheet open={open} onClose={() => setOpen(false)} label="Switch set">
        <Stack gap={3}>
          <h2 className={styles.sheetTitle}>Switch set</h2>
          <Stack gap={2} as="ul" className={styles.switchList}>
            {sets.map((s) => {
              const current = s.setId === setId;
              const ratio = shownRatio(s.tiers);
              // Never colour alone — the word rides with the bar, because green
              // against gold is the pair a deutan collapses into one hue.
              const tier = tierLabel(s.tiers.tier);
              return (
                <li key={s.setId}>
                  <Card
                    onPress={() => go(s.setId, s.setName)}
                    selected={current}
                    label={`${s.setName}, ${s.printings} printings held${current ? ", current set" : ""}`}
                  >
                    <Stack gap={1}>
                      <span className={styles.switchName}>
                        {s.setName}
                        {tier ? <span className={styles.switchTier}> ★ {tier}</span> : null}
                      </span>
                      <span className={styles.switchCount}>
                        {s.printings} {s.printings === 1 ? "printing" : "printings"} held
                      </span>
                      {ratio === undefined ? null : (
                        <Meter value={ratio} label={`${s.setName} progress`} labelHidden />
                      )}
                    </Stack>
                  </Card>
                </li>
              );
            })}
            <li>
              <Card
                onPress={() => {
                  setOpen(false);
                  push({ name: "sets" });
                }}
              >
                All sets
              </Card>
            </li>
          </Stack>
        </Stack>
      </Sheet>
    </>
  );
}
