import { imageSlotSrc } from "../../services/sync/binderImages.ts";
import { specFor, type Binder, type BinderSlot } from "../../models/binderLayout.ts";
import styles from "./WebBindersScreen.module.css";

/**
 * What a binder looks like on the shelf.
 *
 * The list used to describe binders in words — "12-pocket · 107/168 filled" —
 * which is the one thing a collector never uses to tell two binders apart. A
 * binder is recognised the way a book on a shelf is: by what it looks like.
 *
 * Two answers, in order of how much they were MEANT:
 *
 * 1. The binder's own cover, if one has been put in the window on its front.
 *    That is a deliberate choice about what this binder is, made one screen in,
 *    and the shelf is where it pays off — the whole point of setting a cover is
 *    that you see it before you open the binder.
 * 2. Otherwise a real page from it at pocket scale, gaps and all, which is the
 *    next most identifying thing and needs no decision from anybody.
 *
 * Either way it costs nothing to fetch. `CardSlot` carries `imageSmall`
 * denormalised so a page can paint offline (see models/binderLayout.ts), so the
 * art here is exactly the art the binder is already holding — no catalog call,
 * no price call, nothing this screen was not already going to have.
 */

/**
 * Which page stands for the binder.
 *
 * The first page that holds ANYTHING, not literally page 1. A binder with 23
 * pages and a card on page 3 would otherwise get a cover of twelve empty
 * pockets, which is both true and useless — every such binder looks identical.
 * Falling back to page 1 keeps a genuinely empty binder looking empty, which is
 * the one case where "nothing in it" is the fact worth showing.
 */
function coverPage(binder: Binder) {
  return binder.pages.find((page) => Object.keys(page.slots).length > 0) ?? binder.pages[0];
}

export function BinderCover({
  binder,
  owns,
}: {
  binder: Binder;
  /**
   * True when the collection holds this slot. Drives the shading only.
   *
   * A predicate rather than a lookup inside, for the same reason
   * `BinderPageView` takes one: a binder is judged against a collection, and
   * which collection is the caller's business.
   */
  owns: (slot: BinderSlot) => boolean;
}) {
  const spec = specFor(binder.format);
  const page = coverPage(binder);

  /*
   * A cover that was actually chosen wins over a page that merely happened to
   * be first. Drawn as the one card it is, at the frame's full height, so the
   * shelf shows the front of the binder rather than a thumbnail of its guts.
   */
  const chosen = binder.cover ?? null;
  if (chosen) {
    const src = chosen.kind === "card" ? chosen.imageSmall : imageSlotSrc(chosen);
    if (src) {
      return (
        <img
          className={`${styles.coverArt} ${owns(chosen) ? "" : styles.coverWanted}`}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
        />
      );
    }
  }

  return (
    /*
     * Decorative in full. The tile's button already says the binder's name,
     * format and fill in words, so exposing twelve unlabelled images here would
     * add nothing to a screen reader but twelve stops.
     */
    <div
      className={styles.cover}
      style={{
        gridTemplateColumns: `repeat(${spec.cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${spec.rows}, minmax(0, 1fr))`,
        /*
         * The PAGE carries the aspect ratio, not the pocket.
         *
         * Every cover is drawn at one height, so the shelf is a shelf — real
         * binders stand the same height whatever is filed in them. What differs
         * is the WIDTH, because that is what actually differs: a 12-pocket page
         * is four cards across and a 9-pocket page is three, and at a fixed
         * height that is the only honest way to show it. Sizing the pocket
         * instead and letting the page fall out of it is what made a 4-pocket
         * cover taller than a 12-pocket one, which is backwards on a shelf.
         *
         * cols x 5 by rows x 7 is the card's 5:7 at page scale. The 3px gaps
         * are absorbed by the tracks rather than added here — at this size that
         * is under two percent of a pocket, and object-fit takes up the rest.
         */
        aspectRatio: `${spec.cols * 5} / ${spec.rows * 7}`,
      }}
      aria-hidden="true"
    >
      {Array.from({ length: spec.pockets }, (_, index) => {
        const slot = page?.slots[index];
        if (!slot) return <span key={index} className={styles.coverEmpty} />;

        const src = slot.kind === "card" ? slot.imageSmall : imageSlotSrc(slot);
        /*
         * A pocket that is full but has no art is drawn as a card BACK, not as
         * an empty pocket. Binders filled before `imageSmall` was denormalised
         * have slots with no art at all, and rendering those as gaps would
         * report a full binder as an empty one.
         */
        if (!src) return <span key={index} className={styles.coverBlank} />;

        return (
          <img
            key={index}
            className={`${styles.coverCard} ${owns(slot) ? "" : styles.coverWanted}`}
            src={src}
            alt=""
            /* This screen can draw a dozen thumbnails per binder. Lazily, and
               off the main thread: they are texture, not content, and nothing
               below the fold needs to be fetched to answer the question this
               screen exists for. */
            loading="lazy"
            decoding="async"
          />
        );
      })}
    </div>
  );
}
