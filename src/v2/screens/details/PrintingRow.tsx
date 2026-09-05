import { Card, Chip, Money, Row, ScreenReaderOnly, Stack, cx } from "../../primitives/index.ts";
import { exclusionAction, printingState, type Printing } from "./cardFacts.ts";
import styles from "./Details.module.css";

/**
 * One printing, with the two things you can do to it.
 *
 * They are two buttons rather than one, because they answer different
 * questions. Marking says "I have this". Excluding says "this is not part of the
 * set I am building" — TCGdex lists every printing ever made, so without it a
 * box topper or a staff promo reads as permanently missing and the completion
 * figure can never be reached. One control cannot mean both, and a button inside
 * a button is not a thing the DOM has.
 *
 * ## Why an excluded printing is still markable
 *
 * v1 disables the mark on an excluded row. That makes an already-owned printing
 * unmarkable the moment it is excluded — you can no longer take it back off the
 * shelf — and it quietly asserts that the two states are alternatives. They are
 * not: you can own a promo and still not count it toward the set. v2's set
 * screen already treats them as independent (an excluded pocket is dashed, not
 * inert), so this matches it.
 *
 * ## Why there is no `aria-label` on the mark
 *
 * A label would REPLACE the contents as the accessible name, and the contents
 * are what identify the row: which printing, what it is worth, whether it counts
 * toward the set. Six rows on a card differ only in that first line, so a name
 * built from the contents distinguishes them for free — and the price, which a
 * label would have to duplicate by hand and then keep in step, is simply read.
 * The one thing the contents do not say is whether it is held, because the tick
 * is a glyph and the border is a colour. That is the `ScreenReaderOnly` word.
 */
export function PrintingRow({
  printing,
  onToggle,
  onToggleExcluded,
  pricesLoading,
}: {
  printing: Printing;
  onToggle: () => void;
  onToggleExcluded: () => void;
  /** The set's printing index is still on the wire; no price is a "not yet". */
  pricesLoading: boolean;
}) {
  const exclusion = exclusionAction(printing);

  return (
    <li className={styles.printingRow}>
      <Card
        onPress={onToggle}
        selected={printing.held}
        pad={3}
        className={cx(styles.mark, printing.excluded && styles.markExcluded)}
      >
        {/* Every element inside a `Card` with an `onPress` is inside a real
            `<button>`, so each one is a `span`: a `<div>` there is invalid HTML
            and browsers recover from it by closing the button early. */}
        <span className={styles.printingLine}>
          <Row as="span" gap={3} align="center">
            {printing.held ? (
              <span className={styles.tick} aria-hidden="true">
                ✓
              </span>
            ) : (
              <span className={styles.tickEmpty} aria-hidden="true" />
            )}
            <Stack as="span" gap={1}>
              <span className={styles.printingLabel}>{printing.label}</span>
              <span>
                {/*
                  Never `$0.00`. An unpriced printing and a worthless one are
                  not the same printing, and whole sets come back with no prices
                  at all. "n/a" rather than the app-wide "Unavailable" because
                  this is a column of up to six of them under one heading that
                  already says how many could be priced.
                */}
                <Money value={printing.price} loading={pricesLoading} absentLabel="n/a" />
              </span>
            </Stack>
          </Row>

          <Row as="span" gap={2} align="center">
            {/* Its own words, not "not owned": "I still want this" and "this is
                not part of my set" are the difference the state exists for. */}
            {printing.excluded ? <Chip tone="warn">Not in this set</Chip> : null}
            {/* A printing the catalog has never heard of, but the collection has. */}
            {printing.extra ? <Chip>Extra printing</Chip> : null}
          </Row>

          <ScreenReaderOnly>{printingState(printing)}</ScreenReaderOnly>
        </span>
      </Card>

      <Chip onPress={onToggleExcluded} label={exclusion.label}>
        {exclusion.text}
      </Chip>
    </li>
  );
}
