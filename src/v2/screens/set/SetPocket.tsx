import { Card, CardArt, Chip, Money, ScreenReaderOnly, Stack, cx } from "../../primitives/index.ts";
import { pocketState, printingName, type Pocket } from "./setBoard.ts";
import styles from "./Set.module.css";

/**
 * One printing, in one pocket, and the whole pocket is the control.
 *
 * With a finger you tap the printing itself — which is why the glasses' collect
 * mode and printing picker have no counterpart here, and why there is no second
 * button inside this one. v1 needed two (mark, and open details) and had to
 * place them side by side to avoid nesting a button in a button; v2's card
 * details is its own screen, so the pocket has exactly one job.
 *
 * ## Why there is no `aria-label`
 *
 * A label would REPLACE the contents as the accessible name, and the contents
 * are what identify the pocket: the card name, its collector number, which
 * printing, and what it is worth. Two pockets of the same card differ only in
 * the printing line, so a name built from the contents distinguishes them for
 * free — and the price, which a label would have to duplicate by hand and then
 * keep in step, is simply read.
 *
 * The one thing the contents do not say is the state, because the tick is a
 * glyph and the border is a colour. That is what the `ScreenReaderOnly` line at
 * the bottom is for.
 */
export function SetPocket({ pocket, onToggle }: { pocket: Pocket; onToggle: () => void }) {
  const { card, finish, held, excluded, extra, price } = pocket;

  return (
    <Card
      onPress={onToggle}
      selected={held}
      pad={2}
      className={cx(styles.pocket, excluded && styles.pocketExcluded)}
    >
      <Stack as="span" gap={1}>
        <span className={styles.art}>
          {/*
            Decorative: the name is right underneath in text, and a screen
            reader being read nine card names it cannot act on is worse than
            silence. `tile` asks the CDN for a grid-sized image, which is not
            the same thing as a size on the page — the pocket decides that.
          */}
          <CardArt
            src={card.imageSmall}
            name={card.name}
            detail="tile"
            decorative
            className={cx(!held && styles.artMissing)}
          />
          {held ? (
            <span className={styles.tick} aria-hidden="true">
              ✓
            </span>
          ) : null}
        </span>

        <span className={styles.pocketName}>{card.name}</span>
        <span className={styles.pocketMeta}>
          {card.collectorNumber} · {printingName(finish)}
        </span>
        <span className={styles.pocketPrice}>
          {/*
            Never `$0.00`. An unpriced printing and a worthless one are not the
            same printing, and whole sets come back with no prices at all —
            Pitch Black reports nothing for all 120 of its cards.
          */}
          <Money value={price} />
        </span>

        {/* Excluded is its own word, not "not owned": "I still want this" and
            "this is not part of my set" are the difference the state exists for. */}
        {excluded ? <Chip tone="warn">Excluded</Chip> : null}
        {/* A printing the set has never heard of, but the collection has. */}
        {extra ? <Chip>Extra printing</Chip> : null}

        <ScreenReaderOnly>{pocketState(pocket)}</ScreenReaderOnly>
      </Stack>
    </Card>
  );
}
