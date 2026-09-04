import type React from "react";
import { CardImage } from "../../components/CardImage.tsx";
import { imageSlotSrc } from "../../services/sync/binderImages.ts";
import type { Binder, BinderSlot } from "../../models/binderLayout.ts";
import styles from "./WebBinderScreen.module.css";

/**
 * The inside front cover — the leaf page 1 opens against.
 *
 * It was a `::after` pseudo-element: a faint rectangle drawn so that 440px of
 * empty column read as a cover rather than as a page that failed to render. It
 * is a real page now, with a display window in it, because that space is where
 * a binder actually shows what it is — the clear sleeve on the front of a Vault
 * X is the one pocket every binder has.
 *
 * It is NOT a pocket. It carries no index, it is excluded from "26/28 filled",
 * and reformatting between 9 and 12 pockets leaves it alone. See `cover` on the
 * Binder model for why that distinction is in the data and not just here.
 */
export function BinderCoverLeaf({
  binder,
  selected,
  onSelect,
  onPointerDown,
  dropOver,
  dragging,
}: {
  binder: Binder;
  selected: boolean;
  onSelect: () => void;
  onPointerDown?: (slot: BinderSlot, event: React.PointerEvent) => void;
  /** A dragged card is over the cover. */
  dropOver?: boolean;
  /** The cover's own card is in the air. */
  dragging?: boolean;
}) {
  const slot = binder.cover ?? null;
  const label = slot
    ? `Cover, ${slot.kind === "card" ? (slot.name ?? slot.cardId) : (slot.label ?? "custom image")}`
    : "Cover, empty";

  return (
    <div className={styles.coverLeaf}>
      <button
        type="button"
        className={[
          styles.coverWindow,
          slot ? styles.coverFilled : styles.coverEmpty,
          selected ? styles.coverSelected : "",
          dropOver ? styles.coverDropOver : "",
          dragging ? styles.coverDragging : "",
        ]
          .filter(Boolean)
          .join(" ")}
        /* The same attribute the pockets carry, with "cover" as its address —
           so one hit test finds every drop target and one query scrolls the
           selection into view. See addressKey in models/binderLayout.ts. */
        data-pocket="cover"
        aria-label={label}
        aria-pressed={selected}
        onClick={onSelect}
        onPointerDown={slot && onPointerDown ? (event) => onPointerDown(slot, event) : undefined}
      >
        {slot ? (
          slot.kind === "card" ? (
            <CardImage src={slot.imageSmall} alt="" size="thumb" />
          ) : (
            <img className={styles.coverImage} src={imageSlotSrc(slot)} alt={slot.label ?? ""} />
          )
        ) : (
          /* A window, not a call to action. An empty cover is the normal state
             for most binders and should read as blank stationery, not as a task
             the app is nagging about. */
          <span className={styles.coverPlus} aria-hidden="true">
            +
          </span>
        )}
      </button>
      {/* The binder's name, printed on its own cover. The header says it too,
          but the header scrolls away and this is what makes the leaf read as
          the front of THIS binder rather than as a spare page. */}
      <span className={styles.coverName}>{binder.name}</span>
    </div>
  );
}
