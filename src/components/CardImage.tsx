import { useMemo, useState } from "react";
import { optimizedImageUrl } from "../utils/image.ts";
import styles from "./CardImage.module.css";

interface CardImageProps {
  src?: string;
  alt: string;
  /**
   * How big a box the art gets.
   *
   * `thumb` and `large` are FIXED boxes — 54x76 and 120x168 — and that is
   * deliberate: they are what the glasses draw, where a card is read at a
   * glance on a 600x600 additive display and a row of them has to stay
   * predictable.
   *
   * `fill` takes the size of whatever contains it. It exists because this
   * component renders a sized WRAPPER around its img, so a caller with a wider
   * pocket that styled the img alone still got 54px of card: measured on the
   * showcase at 1440x900, 54px of art in a 380px column, and 54px in a 119px
   * column on a phone. The caller owns the geometry in that case, which is the
   * only place that can know it.
   */
  size?: "thumb" | "large" | "fill";
}

// Retina-ish request widths for each display size (kept small for speed).
// `fill` asks for the large one: a container-sized pocket is routinely 200px+
// wide, and the 120px thumb was being upscaled to fill it.
const WIDTH = { thumb: 120, large: 320, fill: 320 } as const;

/**
 * Lazy, size-constrained card image. Loads a small WebP thumbnail from the image
 * CDN first, falls back to the original URL if that fails, then to a labeled
 * placeholder — so a slow/broken image never blocks or shows a broken icon.
 * Result lists pass the small image; details passes the large one.
 */
export function CardImage({ src, alt, size = "thumb" }: CardImageProps) {
  const candidates = useMemo(() => {
    const list = [optimizedImageUrl(src, WIDTH[size]), src].filter((u): u is string => Boolean(u));
    // De-dupe in case the proxy is disabled (optimized === original).
    return [...new Set(list)];
  }, [src, size]);

  const [stage, setStage] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const cls = `${styles.wrap} ${styles[size]}`;
  const current = candidates[stage];

  if (!current) {
    return (
      <div className={cls} role="img" aria-label={alt}>
        <span className={styles.placeholder} aria-hidden="true">
          ▣
        </span>
      </div>
    );
  }

  return (
    <div className={`${cls} ${loaded ? "" : styles.loading}`}>
      <img
        // key forces a fresh load when we advance to a fallback URL.
        key={current}
        src={current}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => {
          setLoaded(false);
          setStage((s) => s + 1);
        }}
      />
    </div>
  );
}
