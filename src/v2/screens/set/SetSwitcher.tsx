import { useState } from "react";
import { useNavigation } from "../../../app/NavigationProvider.tsx";
import { screenToPath } from "../../../app/screenUrl.ts";
import { tierLabel } from "../../../features/collection/completionTier.ts";
import { useCollectedSets } from "../../../hooks/useCollectedSets.ts";
import { setTiers } from "../../../models/setCompletion.ts";
import { Card, Chip, Meter, Sheet, Stack, cx } from "../../primitives/index.ts";
import { completionFigure } from "./setBoard.ts";
import styles from "./Set.module.css";

/**
 * Move to another set without going back first.
 *
 * Master-setting is not one set at a time — a real collection runs to nineteen
 * of them, and moving between two used to mean back, scroll the set list, tap.
 *
 * The list is the sets you own cards from, ordered the way the Collection screen
 * orders them (closest to complete first, via `useCollectedSets`) rather than
 * alphabetically or by release date: the set you are nearly done with is the set
 * you are working on. The 217 you have not started are one tap further on,
 * through "All sets" — putting them here would bury the handful that matter.
 *
 * ## Sheet at both widths, not a rail
 *
 * `RailHost` is the wide-window counterpart of `Sheet`, and this deliberately
 * does not use it. A rail opening and closing changes the width of the main
 * column, which on this screen means every binder page reflows and the pockets
 * change size — a lot of motion to answer a question that is over in one tap.
 * The switcher is a transient picker, not a panel you work beside, so it gets
 * the modal treatment at 390 and at 1440 alike.
 */
export function SetSwitcher({ setId, setName }: { setId: string; setName: string }) {
  const { replace } = useNavigation();
  const collected = useCollectedSets();
  const [open, setOpen] = useState(false);

  /*
   * The set being viewed always appears, even at zero owned. Opening a set from
   * the full list and then finding it missing from its own switcher reads as a
   * bug, and browsing a set you have not started is exactly when you want the
   * other ones to hand.
   */
  const sets = collected.some((s) => s.setId === setId)
    ? collected
    : [{ setId, setName, owned: 0, printings: 0, finishes: {}, tiers: setTiers({}, 0) }, ...collected];

  const go = (id: string, name: string) => {
    setOpen(false);
    if (id === setId) return;
    /*
     * Replace, not push. Switching sets is a lateral move: pushing would make
     * Back walk every set you glanced at instead of leaving for wherever you
     * came from. The filters survive the swap on purpose — "missing only" is a
     * question you ask of set after set.
     */
    replace({ name: "set", setId: id, setName: name });
  };

  return (
    <>
      <Chip onPress={() => setOpen(true)}>Switch set</Chip>

      <Sheet open={open} onClose={() => setOpen(false)} label="Switch set">
        <Stack gap={3}>
          <h2 className={styles.title}>Switch set</h2>
          <ul className={styles.switchList}>
            {sets.map((s) => {
              const figure = completionFigure(s.tiers, s.owned);
              const word = tierLabel(s.tiers.tier);
              const current = s.setId === setId;
              return (
                <li key={s.setId}>
                  <Card onPress={() => go(s.setId, s.setName)} selected={current}>
                    <Stack as="span" gap={2}>
                      <span className={styles.switchName}>
                        {s.setName}
                        {current ? " — you are here" : ""}
                      </span>
                      {/* The bar is why this list is ordered the way it is: it
                          makes "nearly done" visible without reading numbers.
                          Its text row is hidden because the line below already
                          says the figure, with the milestone word attached. */}
                      <Meter value={figure.ratio} label={s.setName} labelHidden />
                      <span className={styles.pocketMeta}>
                        {/* ★ and the uppercase word carry the milestone where
                            colour cannot — base green against master gold is
                            the pair deuteranopia collapses. */}
                        {word ? "★ " : ""}
                        {figure.text}
                        {word ? (
                          <span
                            className={cx(
                              styles.tierWord,
                              s.tiers.tier === "master" ? styles.tierMaster : styles.tierBase,
                            )}
                          >
                            {" "}
                            {word}
                          </span>
                        ) : null}
                        {` · ${s.printings} ${s.printings === 1 ? "printing" : "printings"}`}
                      </span>
                    </Stack>
                  </Card>
                </li>
              );
            })}
            <li>
              {/* A real URL, because this one goes forward rather than sideways
                  and is worth being able to open in a new tab. */}
              <Card href={`#${screenToPath({ name: "sets" })}`}>
                <span className={styles.switchName}>All sets</span>
              </Card>
            </li>
          </ul>
        </Stack>
      </Sheet>
    </>
  );
}
