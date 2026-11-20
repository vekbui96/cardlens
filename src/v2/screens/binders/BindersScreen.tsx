import { useCallback, useMemo } from "react";
import { useLibrary } from "../../../app/LibraryProvider.tsx";
import { useNavigation } from "../../../app/NavigationProvider.tsx";
import { useBindersValue } from "../../../hooks/useBindersValue.ts";
import { emptyBinder, type BinderFormat, type BinderSlot } from "../../../models/binderLayout.ts";
import { Grid, Stack } from "../../primitives/index.ts";
import { BinderTile } from "./BinderTile.tsx";
import { CreateBinderTile } from "./CreateBinderTile.tsx";
import { newBinderId, shelfSummary } from "./shelf.ts";
import styles from "./binders.module.css";

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

  return (
    <Stack gap={5}>
      <Stack gap={1} as="header">
        <h1 className={styles.heading}>Binders</h1>
        {/* What the shelf holds. Hidden when it holds nothing, because "0
            binders · 0 cards" is a fact nobody needed stated twice — the create
            tile below already says the shelf is empty. */}
        {binders.length > 0 ? <p className={styles.summary}>{shelfSummary(binders)}</p> : null}
      </Stack>

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
            onDelete={() => deleteBinder(binder.id)}
          />
        ))}

        <CreateBinderTile onCreate={create} alone={binders.length === 0} />
      </Grid>
    </Stack>
  );
}
