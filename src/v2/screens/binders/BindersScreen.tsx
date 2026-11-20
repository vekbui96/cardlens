import { useCallback, useEffect, useMemo, useState } from "react";
import { useLibrary } from "../../../app/LibraryProvider.tsx";
import { useNavigation } from "../../../app/NavigationProvider.tsx";
import { useBindersValue } from "../../../hooks/useBindersValue.ts";
import {
  emptyBinder,
  type Binder,
  type BinderFormat,
  type BinderSlot,
} from "../../../models/binderLayout.ts";
import { Grid, Stack } from "../../primitives/index.ts";
import { BinderTile } from "./BinderTile.tsx";
import { CreateBinderTile } from "./CreateBinderTile.tsx";
import { newBinderId, shelfSummary } from "./shelf.ts";
import styles from "./binders.module.css";

/** How long "Undo" stays on the shelf after a delete. */
const UNDO_WINDOW_MS = 10_000;

/**
 * Your binders — a shelf.
 *
 * A binder is a layout, not a second collection: it holds positions, and what
 * you own is answered by the collection at render time. That is why a card you
 * do not have can sit in a pocket and simply render shadowed — the binder is a
 * plan, and planning around gaps is the point.
 *
 * The screen answers "which binder is that one" by SIGHT. Everything else here
 * — the fill bar, the format, the total — is what you read once you have found
 * the one you meant.
 */
export function BindersScreen() {
  const { push } = useNavigation();
  const { binders, saveBinder, deleteBinder, ownedFinishes } = useLibrary();

  /**
   * Only the binders that asked to be priced.
   *
   * Filtered HERE rather than inside the hook so the cost is visible at the
   * call site: each binder in this list is a request per SET it spans — the
   * Riolu binder alone touches thirty — and this screen makes none otherwise.
   */
  const priced = useMemo(() => binders.filter((b) => b.showValue), [binders]);
  const values = useBindersValue(priced);

  /**
   * Ownership, for the cover shading. A local map lookup per pocket, no fetch.
   *
   * An image slot is always "held": it is a photo or a divider the owner put
   * there, not a printing the collection could have an opinion about.
   */
  const owns = useCallback(
    (slot: BinderSlot) => (slot.kind === "image" ? true : ownedFinishes(slot.cardId).includes(slot.finish)),
    [ownedFinishes],
  );

  const create = useCallback(
    (name: string, format: BinderFormat) => {
      const binder = emptyBinder(newBinderId(), name, format, Date.now());
      saveBinder(binder);
      // Straight into it. Creating a binder is never the goal; filling it is.
      push({ name: "binder", binderId: binder.id });
    },
    [push, saveBinder],
  );

  /**
   * The binder just deleted, held for a few seconds so it can come back.
   *
   * The tombstone drops the pages, so the only copy of the arrangement is this
   * one. Undo saves it again through the ordinary `saveBinder`, stamped after the
   * tombstone so last-write-wins picks it on every device; nothing new is stored
   * and the merge rule is untouched. Navigating away drops it: the delete stands.
   */
  const [undo, setUndo] = useState<{ binder: Binder; deletedAt: number } | null>(null);

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  const remove = useCallback(
    (binder: Binder) => {
      deleteBinder(binder.id);
      // Taken after the delete, so it is never earlier than the tombstone's own stamp.
      setUndo({ binder, deletedAt: Date.now() });
    },
    [deleteBinder],
  );

  const restore = useCallback(() => {
    if (!undo) return;
    // One past the tombstone, so a same-millisecond tie (which goes to the tombstone) cannot happen.
    saveBinder({ ...undo.binder, updatedAt: Math.max(Date.now(), undo.deletedAt + 1) });
    setUndo(null);
  }, [saveBinder, undo]);

  return (
    <Stack gap={5}>
      <Stack gap={1} as="header">
        <h1 className={styles.heading}>Binders</h1>
        {/* What the shelf holds. Hidden when it holds nothing, because "0
            binders · 0 cards" is a fact nobody needed stated twice — the create
            tile below already says the shelf is empty. */}
        {binders.length > 0 ? <p className={styles.summary}>{shelfSummary(binders)}</p> : null}
      </Stack>

      {undo ? (
        <div role="status" className={styles.undo}>
          <span className={styles.undoText}>Deleted “{undo.binder.name}”.</span>
          <button
            type="button"
            className={styles.undoButton}
            onClick={restore}
            aria-label={`Undo delete of ${undo.binder.name}`}
          >
            Undo
          </button>
        </div>
      ) : null}

      {/*
       * `auto-fill` at a fixed minimum, which is only safe because a cover is a
       * fixed HEIGHT (see binders.module.css). While the cover took its height
       * from the column width, a track that could be any width made the tiles
       * any height and the shelf jumped a row taller mid-resize.
       */}
      <Grid as="ul" min="pocket-lg" gap={4} className={styles.shelf}>
        {binders.map((binder) => (
          <BinderTile
            key={binder.id}
            binder={binder}
            owns={owns}
            summary={values.byId.get(binder.id)}
            valuesLoading={values.isLoading}
            onOpen={() => push({ name: "binder", binderId: binder.id })}
            onDelete={() => remove(binder)}
          />
        ))}

        <CreateBinderTile onCreate={create} alone={binders.length === 0} />
      </Grid>
    </Stack>
  );
}
