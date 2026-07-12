import { useMemo, useState } from "react";
import { optimizedImageUrl } from "../utils/image.ts";
import styles from "./CardImage.module.css";

interface CardImageProps {
  src?: string;
  alt: string;
  size?: "thumb" | "large";
}

// Retina-ish request widths for each display size (kept small for speed).
const WIDTH = { thumb: 120, large: 320 } as const;

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
  const cls = `${styles.wrap} ${size === "large" ? styles.large : styles.thumb}`;
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
