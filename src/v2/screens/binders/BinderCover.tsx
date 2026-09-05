import type { CSSProperties } from "react";
import { specFor, type Binder } from "../../../models/binderLayout.ts";
import { CardArt, cx } from "../../primitives/index.ts";
import { chosenCover, coverPockets, pageAspect, type Owns } from "./shelf.ts";
import styles from "./binders.module.css";

/**
 * What a binder looks like on the shelf.
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
 * **Either way it costs nothing to fetch.** `CardSlot` carries `imageSmall`
 * denormalised so a page can paint offline, so the art here is exactly the art
 * the binder is already holding — no catalog call, no price call, nothing this
 * screen was not already going to have. Every image is lazy, so opening the
 * shelf asks for the tiles you can see and no more.
 *
 * **Decorative in full.** The tile's button already says the binder's name, its
 * format and how full it is in words, so exposing twelve unlabelled images here
 * would add nothing to a screen reader but twelve stops. `getByRole("img")`
 * finds nothing on this screen, and that is asserted rather than hoped for.
 */

/** Local custom properties the stylesheet consumes. */
type Vars = CSSProperties & Record<`--${string}`, string>;

export function BinderCover({ binder, owns }: { binder: Binder; owns: Owns }) {
  const spec = specFor(binder.format);
  const chosen = chosenCover(binder, owns);

  if (chosen) {
    return (
      <div className={cx(styles.chosen, !chosen.owned && styles.wanted)} data-cover="card">
        <CardArt src={chosen.src} name={chosen.name} detail="tile" decorative />
      </div>
    );
  }

  const vars: Vars = {
    "--cols": String(spec.cols),
    "--rows": String(spec.rows),
    "--page-aspect": pageAspect(spec),
  };

  return (
    <div
      className={styles.page}
      style={vars}
      data-cover="page"
      data-page-format={binder.format}
      aria-hidden="true"
    >
      {coverPockets(binder, owns).map((pocket, index) => (
        <div key={index} className={cx(pocket.kind === "card" && !pocket.owned && styles.wanted)}>
          {pocket.kind === "empty" ? (
            <CardArt name="" empty />
          ) : (
            /*
             * A pocket that is full but has no art is drawn as a card BACK, not
             * as a gap — `CardArt` does that for us when `src` is absent.
             * Binders filled before `imageSmall` was denormalised have slots
             * with no art at all, and rendering those as empty pockets would
             * report a full binder as an empty one.
             */
            <CardArt src={pocket.src} name={pocket.name} detail="tile" decorative />
          )}
        </div>
      ))}
    </div>
  );
}
