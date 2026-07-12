import { useState } from "react";
import styles from "./CardImage.module.css";

interface CardImageProps {
  src?: string;
  alt: string;
  size?: "thumb" | "large";
}

/**
 * Lazy, size-constrained card image with a graceful fallback. Result lists pass
 * the small image; details passes the large one (spec: never load full-size in
 * lists). Failures fall back to a labeled placeholder rather than a broken icon.
 */
export function CardImage({ src, alt, size = "thumb" }: CardImageProps) {
  const [failed, setFailed] = useState(false);
  const cls = `${styles.wrap} ${size === "large" ? styles.large : styles.thumb}`;

  if (!src || failed) {
    return (
      <div className={cls} role="img" aria-label={alt}>
        <span className={styles.placeholder} aria-hidden="true">
          ▣
        </span>
      </div>
    );
  }

  return (
    <div className={cls}>
      <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />
    </div>
  );
}
