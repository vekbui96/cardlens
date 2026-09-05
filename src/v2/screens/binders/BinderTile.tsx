import { useState } from "react";
import { Card, Chip, Meter, Money, Row, Stack } from "../../primitives/index.ts";
import { screenToPath } from "../../../app/screenUrl.ts";
import { countBinder, type Binder, type BinderSlot } from "../../../models/binderLayout.ts";
import type { BinderValueSummary } from "../../../models/binderValue.ts";
import { BinderCover } from "./BinderCover.tsx";
import { fillOf, metaLine, valueState } from "./binderShelf.ts";
import styles from "./binders.module.css";

/**
 * One binder on the shelf.
 *
 * A tile rather than a row, and the change is not decoration. The row design
 * gave a binder 56px of height and spent all of it on words, so six binders read
 * as six identical grey bars and the only way to find one was to read the names
 * in order. The cover answers that at a glance — and it is free, because the art
 * is already in the binder.
 */
export function BinderTile({
  binder,
  owns,
  summary,
  valuesLoading,
  onDelete,
}: {
  binder: Binder;
  owns: (slot: BinderSlot) => boolean;
  summary: BinderValueSummary | undefined;
  valuesLoading: boolean;
  onDelete: () => void;
}) {
  /**
   * Deleting takes two presses, and the second one is a different button.
   *
   * A binder is pages of arrangement that took an evening to build, and there is
   * no undo — the delete writes a tombstone precisely so the deletion SURVIVES a
   * sync, which means a misclick propagates to every device. v1 shipped a bare
   * red "Delete" next to the name on every row before this.
   */
  const [confirming, setConfirming] = useState(false);

  const counts = countBinder(binder);
  const fill = fillOf(counts);
  const value = binder.showValue ? valueState(summary, valuesLoading) : null;

  return (
    <li className={styles.tile}>
      <Card
        href={`#${screenToPath({ name: "binder", binderId: binder.id })}`}
        label={`${binder.name}, ${fill.text} pockets filled${binder.forTrade ? ", for trade" : ""}`}
        pad={3}
      >
        <Stack gap={3}>
          <BinderCover binder={binder} owns={owns} />

          <Stack gap={2}>
            <Row gap={2} align="baseline" wrap>
              <span className={styles.name}>{binder.name}</span>
              {/* A binder on offer looked like any other in this list, and
                  "which one did I mark for trade" is the question the shelf
                  exists to answer at a glance. */}
              {binder.forTrade ? <Chip tone="accent">For trade</Chip> : null}
            </Row>

            {/*
              The fill, as a bar and as a number. The number alone is the wrong
              shape for the question — "107/168" has to be divided in your head,
              and four binders' worth of that is why nobody read the meta line.
              Complete turns the bar gold AND says "complete" in words, because
              green against gold is exactly the pair deuteranopia collapses.

              `labelHidden`, because the label is the binder's name and it is
              already the largest thing on the tile — printing it again under
              the bar spent two lines saying "Jolteon filled" next to the word
              Jolteon. The progressbar keeps the name for assistive technology,
              where there is no "above" to have read it in.
            */}
            <Meter value={fill.ratio} label={`${binder.name} filled`} labelHidden />

            {/*
              Two lines rather than one that wraps. The first is how full the
              binder is, which is what you scan the shelf for; the second is what
              shape it is, which you look at once. Joined, they do not fit a tile
              at any column count, and where they broke depended on the name
              above — which made a row of tiles ragged for no reason.
            */}
            <span className={styles.count}>
              {fill.text}
              {fill.complete ? " · complete" : ""}
            </span>
            <span className={styles.meta}>{metaLine(binder, counts)}</span>

            {/* The headline figure, for binders that asked for one. The unpriced
                count rides with it rather than being dropped: whole sets have no
                market price upstream, and a total that hid that would read as
                the whole answer. */}
            {value ? (
              <Row gap={2} align="baseline" wrap>
                <Money value={value.total} loading={value.loading} />
                {value.note ? <span className={styles.note}>· {value.note}</span> : null}
              </Row>
            ) : null}
          </Stack>
        </Stack>
      </Card>

      {confirming ? (
        <div className={styles.confirm} role="group" aria-label={`Delete ${binder.name}?`}>
          <p className={styles.confirmText}>Delete “{binder.name}”?</p>
          <Row gap={2} justify="center" wrap>
            <Chip onPress={() => setConfirming(false)} label={`Keep ${binder.name}`}>
              Keep
            </Chip>
            <Chip tone="warn" onPress={onDelete} label={`Confirm delete ${binder.name}`}>
              Delete
            </Chip>
          </Row>
        </div>
      ) : (
        <button
          type="button"
          className={styles.remove}
          onClick={() => setConfirming(true)}
          aria-label={`Delete ${binder.name}`}
        >
          {/* A glyph, not the word: "Delete" in red was the second loudest thing
              on a screen whose subject is the binders. */}
          <span aria-hidden="true">✕</span>
        </button>
      )}
    </li>
  );
}
