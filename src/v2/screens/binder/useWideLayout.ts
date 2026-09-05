import { useEffect, useState } from "react";

/**
 * The width at which the binder falls open.
 *
 * ONE breakpoint for two decisions, because they are the same decision. Below
 * it the binder reads a page at a time and the picker is a sheet from the
 * bottom, where a thumb is — the layout confirmed on hardware. At or above it
 * the pages face each other and the picker is a rail beside them, which is also
 * what makes dragging a card from the list into a pocket possible at all.
 *
 * 62.5em is 1000px, and 1000px is what a 12-pocket spread plus a rail actually
 * costs: two pages of four pockets and the gutter come to 1108px on their own,
 * and the rail is another 320. Below that the spread cannot be shown without
 * shrinking the pocket, and a pocket is a pocket.
 *
 * Written in `em` so that `binder.module.css` — which cannot read a custom
 * property in a media query, and therefore has to repeat the number — can use
 * the identical query. A media query's `em` is the browser's INITIAL font size
 * rather than the root element's, so the two agree exactly at any zoom level or
 * default text size. A px query here beside an em query there is how a rail
 * comes out next to pages that are still stacked.
 *
 * It is a media QUERY rather than a measured element on purpose. The rail's
 * presence changes the width of the column the spread is in, so measuring that
 * column to decide whether to show the rail is a loop — the panel would flicker
 * itself open and shut at exactly the width where it mattered.
 */
export const WIDE_LAYOUT = "(min-width: 62.5em)";

export function useWideLayout(query: string = WIDE_LAYOUT): boolean {
  /*
   * Read once at mount rather than defaulting to false. Starting narrow and
   * correcting in an effect renders the phone layout for a frame on every
   * desktop load — which on this screen means the pages laid out singly and
   * then jumping into spreads.
   */
  const [wide, setWide] = useState(() => window.matchMedia?.(query)?.matches === true);

  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [query]);

  return wide;
}
