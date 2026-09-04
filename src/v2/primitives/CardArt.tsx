import styles from "./primitives.module.css";
import { cx } from "./layout.tsx";
import { optimizedImageUrl } from "../../utils/image.ts";

/**
 * The one way v2 draws a card.
 *
 * There is deliberately **no width or height prop**. The art fills its
 * container and holds `--v2-card-aspect`; how big it is, is the container's
 * business. v1 has three components that draw a card and one of them hard-codes
 * a 54x76 wrapper, which is how 54px of art ended up centred inside a 380px
 * binder pocket and, separately, inside a 92px picker tile. Neither call site
 * was wrong; the component was.
 *
 * `detail` is the exception, and it is not a size — it is how much image to
 * ASK the CDN for. It has to exist because the resizing proxy needs a number in
 * the URL, and picking it from the container would mean measuring on every
 * render. Named steps keep it a quality decision rather than a layout one.
 */

/** How much image to fetch. A hint to the CDN, not a size on the page. */
export type ArtDetail = "tile" | "pocket" | "hero";

const REQUEST_WIDTH: Record<ArtDetail, number> = {
  /** A dense grid — a set page, a picker. */
  tile: 180,
  /** A binder pocket, where the art is the point. */
  pocket: 320,
  /** One card, large: details, the showcase stage, the image viewer. */
  hero: 720,
};

interface CardArtProps {
  /** The card's image URL. Absent is normal, not an error — see below. */
  src?: string | undefined;
  /**
   * The card's name. Used as alt text, and shown on the face-down back when
   * there is no art, so a card without an image is still identifiable.
   */
  name: string;
  detail?: ArtDetail;
  /**
   * True where the art repeats something already in text — a binder cover
   * beside its own name, a mosaic on a tile whose button is already labelled.
   * Renders `alt=""` and `aria-hidden`, so a screen reader is not read a list
   * of nine card names it has no way to act on.
   */
  decorative?: boolean;
  /** Renders the empty-pocket outline instead of a card. */
  empty?: boolean;
  /** First screenful only; everything below the fold should stay lazy. */
  eager?: boolean;
  className?: string;
}

export function CardArt({
  src,
  name,
  detail = "tile",
  decorative = false,
  empty = false,
  eager = false,
  className,
}: CardArtProps) {
  if (empty) {
    return (
      <div className={cx(styles.art, styles.artHostEmpty, className)} aria-hidden="true">
        <div className={cx(styles.artBack, styles.artEmpty)} />
      </div>
    );
  }

  const url = optimizedImageUrl(src, REQUEST_WIDTH[detail]);

  /*
   * No art is the ordinary case, not a failure: `CardSlot` carries a
   * denormalised `imageSmall` that older rows predate, and some sets never
   * had one. A face-down card says "a card is here" — an empty box says the
   * binder is empty, which is the wrong answer to a different question.
   */
  if (!url) {
    return (
      <div className={cx(styles.art, className)} {...(decorative ? { "aria-hidden": "true" } : {})}>
        <div className={styles.artBack}>{decorative ? null : name}</div>
      </div>
    );
  }

  return (
    <div className={cx(styles.art, className)} {...(decorative ? { "aria-hidden": "true" } : {})}>
      <img
        className={styles.artImg}
        src={url}
        alt={decorative ? "" : name}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        draggable={false}
      />
    </div>
  );
}
