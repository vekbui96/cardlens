/**
 * The v2 vocabulary.
 *
 * A screen imports from here and from nowhere else in `src/v2/primitives/`.
 * Nine screens are built against this at the same time, so the set has to be
 * small enough to hold in your head and complete enough that nobody needs to
 * invent a tenth thing — the failure mode is not a missing primitive, it is
 * four streams each writing their own card tile.
 */

export { Stack, Row, Grid, ScreenReaderOnly, cx } from "./layout.tsx";
export { Panel, Card } from "./surfaces.tsx";
export { CardArt, type ArtDetail } from "./CardArt.tsx";
export { Meter, Chip, Money } from "./data.tsx";
export { RailHost, Sheet } from "./disclosure.tsx";
export { space, cardWidth, type Space, type CardWidth, type Align, type Justify } from "./tokens.ts";
