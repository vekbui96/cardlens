import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { CardArt, cx } from "../../primitives/index.ts";
import type { Binder, BinderSlot } from "../../../models/binderLayout.ts";
import { coverLabel, pageVars, slotArt, slotTitle } from "./binderBuilder.ts";
import styles from "./binder.module.css";

/**
 * The inside front cover — the leaf page 1 opens against.
 *
 * It is a real slot with a display window in it, because that space is where a
 * binder actually shows what it is: the clear sleeve on the front of a Vault X
 * is the one pocket every binder has, and it is what makes a binder recognisable
 * on the shelf one screen up.
 *
 * **It is not a pocket.** No index, excluded from "26/28 filled", untouched by
 * `reformat` when the binder changes between 9 and 12 pockets, and it survives a
 * reload because it lives on the binder rather than in a page. See `cover` on
 * the Binder model for why that distinction is in the data and not only here.
 *
 * It carries `data-pocket="cover"` all the same, so one hit test finds every
 * drop target and one query scrolls the selection into view — the address is
 * tagged rather than numbered precisely so it can travel through the drag
 * without ever being arithmetic. See `addressKey`.
 */
export function BinderCoverLeaf({
  binder,
  selected,
  dropOver,
  dragging,
  onSelect,
  onPointerDown,
  side,
}: {
  binder: Binder;
  selected: boolean;
  dropOver: boolean;
  dragging: boolean;
  onSelect: () => void;
  onPointerDown: (slot: BinderSlot, event: ReactPointerEvent) => void;
  side: "left" | "solo";
}) {
  const slot = binder.cover ?? null;

  return (
    <div
      className={cx(styles.leaf, side === "left" && styles.sideLeft)}
      style={pageVars(binder.format) as CSSProperties}
    >
      <button
        type="button"
        className={cx(
          styles.coverWindow,
          selected && styles.pocketSelected,
          dropOver && styles.pocketOver,
          dragging && styles.pocketDragging,
        )}
        data-pocket="cover"
        aria-label={coverLabel(binder)}
        aria-pressed={selected}
        onClick={onSelect}
        onPointerDown={slot ? (event) => onPointerDown(slot, event) : undefined}
      >
        {slot ? (
          <CardArt
            src={slotArt(slot)}
            name={slotTitle(slot)}
            detail="pocket"
            decorative
            className={styles.art}
          />
        ) : (
          <span className={styles.coverPlus} aria-hidden="true">
            +
          </span>
        )}
      </button>
      {/* The binder's name, printed on its own cover, under the word for what
          this leaf IS. The header says the name too, but the header scrolls away
          — and without "Cover" the leaf reads as a page that failed to render. */}
      <span className={styles.coverName}>
        <span className={styles.coverKind}>Cover</span>
        {binder.name}
      </span>
    </div>
  );
}
