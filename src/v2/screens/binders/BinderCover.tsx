import type { CSSProperties } from "react";
import { CardArt, cx } from "../../primitives/index.ts";
import { specFor, type Binder, type BinderSlot } from "../../../models/binderLayout.ts";
import { coverArt, slotSrc } from "./binderShelf.ts";
import styles from "./binders.module.css";

/**
 * What a binder looks like on the shelf.
 *
 * The list used to describe binders in words — "12-pocket · 107/168 filled" —
 * which is the one thing a collector never uses to tell two binders apart. A
 * binder is recognised the way a book on a shelf is: by what it looks like.
 *
 * **It costs nothing to fetch.** `CardSlot` carries `imageSmall` denormalised so
 * a page can paint offline, so the art here is exactly the art the binder is
 * already holding — no catalog call, no price call, nothing this screen was not
 * already going to have. Everything is lazy, because a shelf can draw a dozen
 * thumbnails per binder and nothing below the fold needs fetching to answer the
 * question the screen exists for.
 *
 * All of it is decorative. The tile's link already carries the binder's name,
 * format and fill in words, so exposing twelve unlabelled images would add a
 * screen reader nothing but twelve stops — and `getByRole("img")` finds nothing
 * on this screen, which the e2e asserts.
 */
type Vars = CSSProperties & Record<`--${string}`, string>;

export function BinderCover({
  binder,
  owns,
}: {
  binder: Binder;
  /**
   * True when the collection holds this slot. Drives the shading only.
   *
   * A predicate rather than a lookup inside: a binder is judged against a
   * collection, and which collection is the caller's business.
   */
  owns: (slot: BinderSlot) => boolean;
}) {
  const art = coverArt(binder);

  if (art.kind === "chosen") {
    return (
      <span className={styles.coverFrame}>
        <CardArt
          src={slotSrc(art.slot)}
          name=""
          detail="tile"
          decorative
          className={cx(styles.chosen, owns(art.slot) ? undefined : styles.wanted)}
        />
      </span>
    );
  }

  const spec = specFor(binder.format);
  /*
   * The page's ideal width, from its own geometry: a pocket is as tall as the
   * frame divided by the rows, and 5/7 of that across. Stated here rather than
   * as a per-format constant so a fourth format would need no new number.
   */
  const vars: Vars = {
    "--cols": String(spec.cols),
    "--rows": String(spec.rows),
    "--page-w": `calc((var(--v2-pocket-lg) - ${spec.rows - 1} * var(--v2-space-1)) / ${spec.rows} * 5 / 7 * ${spec.cols} + ${spec.cols - 1} * var(--v2-space-1))`,
  };

  return (
    <span className={styles.coverFrame}>
      {/*
        `data-cover-format` exists for one assertion that has no accessible
        expression: a 12-pocket cover must be visibly WIDER than a 9-pocket one,
        which is a measurement in pixels and not something a role or a name can
        carry. Everything else on this screen is selected by role.
      */}
      <span className={styles.page} style={vars} data-cover-format={binder.format} aria-hidden="true">
        {art.slots.map((slot, index) => (
          <span key={index} className={styles.pocket}>
            {/*
              An empty pocket uses the primitive's own outline rather than a
              local one, so a gap on the shelf looks like a gap in the builder.
              A pocket that is FULL but has no art is a face-down card, not a
              gap: binders filled before `imageSmall` was denormalised have
              slots with no art at all, and drawing those as gaps would report
              a full binder as an empty one.
            */}
            {slot ? (
              <CardArt
                src={slotSrc(slot)}
                name=""
                detail="tile"
                decorative
                className={owns(slot) ? undefined : styles.wanted}
              />
            ) : (
              <CardArt name="" empty />
            )}
          </span>
        ))}
      </span>
    </span>
  );
}
