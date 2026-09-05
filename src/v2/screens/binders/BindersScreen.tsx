import { useMemo } from "react";
import { Grid, Stack } from "../../primitives/index.ts";
import { useLibrary } from "../../../app/LibraryProvider.tsx";
import { useNavigation } from "../../../app/NavigationProvider.tsx";
import { useBindersValue } from "../../../hooks/useBindersValue.ts";
import { emptyBinder, type BinderFormat, type BinderSlot } from "../../../models/binderLayout.ts";
import { BinderTile } from "./BinderTile.tsx";
import { CreateTile } from "./CreateTile.tsx";
import { newBinderId, pricedBinders, shelfSummary } from "./binderShelf.ts";
import styles from "./binders.module.css";

/**
 * The shelf.
 *
 * A binder is a LAYOUT, not a second collection: it holds positions, and what
 * you own is answered by the collection at render time. That is why a card you
 * do not have can sit in a pocket and simply render shadowed — a binder is a
 * plan, and planning around gaps is the point.
 *
 * ## What this screen costs
 *
 * Nothing, for most people. The covers are free — `CardSlot` carries
 * `imageSmall` denormalised, so the art is already in local storage and every
 * image is lazy. The only requests come from `useBindersValue`, and it is given
 * ONLY the binders that opted into a total via `showValue`. That filter is here,
 * at the call site, rather than inside the hook, because the cost is visible
 * here and nowhere else: pricing one binder means a request for every set it
 * spans, and the Riolu binder alone spans thirty.
 */
export function BindersScreen() {
  const { push } = useNavigation();
  const { binders, saveBinder, deleteBinder, ownedFinishes } = useLibrary();

  const priced = useMemo(() => pricedBinders(binders), [binders]);
  const values = useBindersValue(priced);

  /**
   * Ownership, for the cover shading. A local map lookup per pocket, no fetch.
   *
   * An image slot is always "held": it is a photo or a divider the owner put
   * there, not a printing the collection could have an opinion about.
   */
  const owns = useMemo(
    () => (slot: BinderSlot) =>
      slot.kind === "image" ? true : ownedFinishes(slot.cardId).includes(slot.finish),
    [ownedFinishes],
  );

  const create = (name: string, format: BinderFormat) => {
    const binder = emptyBinder(newBinderId(), name, format, Date.now());
    saveBinder(binder);
    // Straight into it: a binder is created in order to be laid out, and
    // stopping on the shelf to find the tile you just made is a wasted step.
    push({ name: "binder", binderId: binder.id });
  };

  return (
    <Stack gap={5}>
      <header>
        <h1 className={styles.title}>Binders</h1>
        {binders.length > 0 ? <p className={styles.summary}>{shelfSummary(binders)}</p> : null}
      </header>

      <Grid as="ul" min="pocket-lg" gap={4} className={styles.shelf}>
        {binders.map((binder) => (
          <BinderTile
            key={binder.id}
            binder={binder}
            owns={owns}
            summary={values.byId.get(binder.id)}
            valuesLoading={values.isLoading}
            onDelete={() => deleteBinder(binder.id)}
          />
        ))}
        <CreateTile onCreate={create} />
      </Grid>
    </Stack>
  );
}
