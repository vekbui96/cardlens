import { Card, CardArt, cx, Money, Stack } from "../../primitives/index.ts";
import { finishLabel } from "../../../models/finishes.ts";
import type { PrintingSlot } from "./slots.ts";
import styles from "./set.module.css";

/**
 * One pocket: one printing, one target.
 *
 * The whole tile is the button. With a finger you tap the printing itself,
 * which is why the glasses' collect mode and printing picker have no
 * counterpart here — both exist there only because a pinch has to be told WHICH
 * printing it means. A pocket is `--v2-pocket` wide, so the 44px minimum is met
 * several times over; it is asserted in the e2e anyway, because "obviously big
 * enough" is how targets shrink.
 *
 * Held is carried by `aria-pressed`, by a tick, AND by the word "Held". The
 * accent border is the reward for noticing, never the information: the border
 * and the tick are the same hue family, and colour alone would leave a deutan
 * reading a grid of identical tiles.
 */
export function SetPocket({
  slot,
  price,
  onToggle,
  /** First screenful only; everything below the fold stays lazy. */
  eager = false,
}: {
  slot: PrintingSlot;
  price: number | undefined;
  onToggle: () => void;
  eager?: boolean;
}) {
  const { card, finish, held, excluded, extra } = slot;
  const printing = finishLabel(finish);

  /*
   * "Excluded" is its own word, not "not owned". The difference between "I
   * still want this" and "this is not part of my set" is the whole reason the
   * state exists, and collapsing them would make a deliberately-skipped promo
   * read as a permanent gap.
   */
  const state = excluded ? "excluded" : held ? "owned" : "not owned";

  return (
    <li className={styles.pocket}>
      <Card
        onPress={onToggle}
        selected={held}
        pad={2}
        // The number is in the label because a card with two printings renders
        // two of these, and identical names make them indistinguishable to a
        // screen reader.
        label={`${card.name}, ${card.collectorNumber}, ${printing}, ${state}`}
        className={cx(styles.pocketCard, excluded && styles.pocketExcluded)}
      >
        <Stack gap={2}>
          <div className={cx(styles.art, !held && styles.artMissing)}>
            {/* Dimmed rather than hidden: a grid of greyed art is readable at a
                glance, a grid with holes in it is not. */}
            <CardArt src={card.imageSmall} name={card.name} detail="tile" decorative eager={eager} />
            {held ? (
              <span className={styles.tick} aria-hidden="true">
                ✓
              </span>
            ) : null}
          </div>

          <Stack gap={1}>
            <span className={styles.pocketName}>{card.name}</span>
            <span className={styles.pocketMeta}>
              {card.collectorNumber} · {printing}
              {extra ? " · hand-marked" : ""}
            </span>
            <span className={styles.pocketFoot}>
              {/* An excluded printing has no price worth quoting — it is not
                  part of what is being collected. */}
              {excluded ? <span className={styles.pocketState}>Not in set</span> : <Money value={price} />}
              {held ? <span className={styles.pocketHeld}>Held</span> : null}
            </span>
          </Stack>
        </Stack>
      </Card>
    </li>
  );
}
