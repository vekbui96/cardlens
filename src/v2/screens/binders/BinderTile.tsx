import { useState } from "react";
import { countBinder, type Binder } from "../../../models/binderLayout.ts";
import type { BinderValueSummary } from "../../../models/binderValue.ts";
import { Card, Chip, Meter, Money, Row, Stack } from "../../primitives/index.ts";
import { BinderCover } from "./BinderCover.tsx";
import { metaLine, tileLabel, valuePending, type Owns } from "./shelf.ts";
import styles from "./binders.module.css";

/**
 * One binder on the shelf.
 *
 * A tile rather than a row, and the change is not decoration: the row design
 * gave a binder 56px of height and spent all of it on words, so six binders
 * read as six identical grey bars and the only way to find one was to read the
 * names in order. The cover answers that at a glance — and it is free, because
 * the art is already in the binder (see BinderCover).
 *
 * The delete control is a SIBLING of the open button rather than inside it: a
 * button cannot contain a button, and putting the destructive action inside the
 * thing you press to open the binder is how it got pressed by accident.
 */

interface BinderTileProps {
  binder: Binder;
  owns: Owns;
  /** Absent means this binder did not opt in to being priced. */
  summary?: BinderValueSummary | undefined;
  valuesLoading: boolean;
  onOpen: () => void;
  onDelete: () => void;
}

export function BinderTile({ binder, owns, summary, valuesLoading, onOpen, onDelete }: BinderTileProps) {
  /**
   * Deleting takes two presses, and the second one is on a different button.
   *
   * A binder is pages of arrangement that took an evening to build and there is
   * no undo — the delete writes a tombstone precisely so the deletion SURVIVES
   * a sync, which means a misclick propagates to every device. The design this
   * replaced had a bare red "Delete" sitting next to the name on every row.
   */
  const [confirming, setConfirming] = useState(false);

  const counts = countBinder(binder);
  const ratio = counts.pockets > 0 ? counts.filled / counts.pockets : 0;
  const complete = counts.pockets > 0 && counts.filled === counts.pockets;

  /*
   * `data-binder-tile` exists for the geometry assertions, and only those: that
   * every tile in a row is the same height, and that a 12-pocket cover is wider
   * than a 9-pocket one. Behaviour is selected by role and accessible name like
   * everything else — but a bounding box has no role, and a CSS module class
   * name is one rename away from breaking a test that was never about names.
   */
  return (
    <li className={styles.tile} data-binder-tile={binder.id}>
      <Card onPress={onOpen} label={tileLabel(binder, counts)} className={styles.open}>
        {/*
         * A Stack inside the Card rather than turning the Card itself into a
         * column: `.card` already declares `display`, and two single-class
         * rules in different stylesheets disagreeing about it is decided by
         * whichever bundle order the build happens to produce. Only properties
         * the primitive does not set are safe to add from here.
         */}
        <Stack gap={2} className={styles.openBody}>
          <div className={styles.coverFrame} data-cover-frame="">
            <BinderCover binder={binder} owns={owns} />
          </div>

          <span className={styles.name}>{binder.name}</span>

          {/* A binder that is on offer looked like any other in this list, and
            "which one did I mark for trade" is the question the shelf exists to
            answer at a glance. Said in the button's label too — a chip is a
            colour and a word, and the word is the part that carries. */}
          {binder.forTrade ? (
            <Row gap={1} wrap>
              <Chip tone="accent">For trade</Chip>
            </Row>
          ) : null}

          {/*
           * The fill, as a bar AND as a number.
           *
           * The number alone is the wrong shape for the question: "107/168" has
           * to be divided in your head, and four binders' worth of that is why
           * nobody read the meta line. The bar is read by length, the number when
           * you care about the exact figure, and neither decorates the other.
           * Complete turns the bar gold and SAYS "Complete" beside it — gold
           * against the accent is a pair some eyes collapse.
           */}
          <Meter
            value={ratio}
            label={`${counts.filled}/${counts.pockets}`}
            detail={complete ? "Complete" : `${Math.round(ratio * 100)}%`}
          />

          <span className={styles.meta}>{metaLine(binder, counts)}</span>

          <span className={styles.spacer} />

          {/* The headline figure, for binders that asked for one. The unpriced
            count rides with it rather than being dropped: whole sets have no
            market price, and a total that hid that would read as the whole
            answer. */}
          {binder.showValue ? <BinderTotal summary={summary} loading={valuesLoading} /> : null}
        </Stack>
      </Card>

      {confirming ? (
        <div className={styles.confirm} role="group" aria-label={`Delete ${binder.name}?`}>
          <p className={styles.confirmText}>Delete “{binder.name}”?</p>
          <Row gap={2} justify="center">
            <button
              type="button"
              className={styles.confirmNo}
              onClick={() => setConfirming(false)}
              aria-label={`Keep ${binder.name}`}
            >
              Keep
            </button>
            <button
              type="button"
              className={styles.confirmYes}
              onClick={onDelete}
              aria-label={`Confirm delete ${binder.name}`}
            >
              Delete
            </button>
          </Row>
        </div>
      ) : (
        <button
          type="button"
          className={styles.remove}
          onClick={() => setConfirming(true)}
          aria-label={`Delete ${binder.name}`}
        >
          {/* A glyph, not the word: "Delete" in red was the second loudest
              thing on a screen whose subject is the binders. */}
          <span aria-hidden="true">✕</span>
        </button>
      )}
    </li>
  );
}

/**
 * A binder's total, on its tile.
 *
 * "Pricing…" rather than a blank or a zero while the sets answer: a total that
 * appears out of nothing looks like a number that changed, and `$0.00` is the
 * one thing this figure must never say when it simply does not know yet. That
 * is `Money`'s whole job, so the decision here is only WHEN it is still in
 * flight — and that decision lives in `valuePending`, where it can be tested
 * without thirty set fetches and a React render.
 */
function BinderTotal({ summary, loading }: { summary?: BinderValueSummary | undefined; loading: boolean }) {
  const pending = valuePending(summary, loading);
  return (
    <span className={styles.value}>
      <Money value={summary?.total} loading={pending} />
      {/* Withheld while pending: an unpriced count taken mid-flight counts the
          sets that have not answered yet, which is not what it says. */}
      {!pending && summary && summary.unpriced > 0 ? (
        <span className={styles.unpriced}> · {summary.unpriced} unpriced</span>
      ) : null}
    </span>
  );
}
