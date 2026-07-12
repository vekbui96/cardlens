import { useMemo, useState } from "react";
import { useWearableInput } from "../hooks/useWearableInput.ts";
import { optimizedImageUrl } from "../utils/image.ts";
import styles from "./ImageFullView.module.css";

/**
 * Full-screen card image. Opened by selecting the card image on the details
 * screen; closes on SELECT, BACK, or click. Loads a high-quality WebP (falls back
 * to the original), sized to the 600×600 display.
 */
export function ImageFullView({ src, alt, onClose }: { src?: string; alt: string; onClose: () => void }) {
  const candidates = useMemo(
    () => [...new Set([optimizedImageUrl(src, 560), src].filter((u): u is string => Boolean(u)))],
    [src],
  );
  const [stage, setStage] = useState(0);
  const current = candidates[stage];

  useWearableInput((e) => {
    if (e.type === "SELECT" || e.type === "BACK") onClose();
  });

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={`${alt} — full screen`}
      onClick={onClose}
    >
      {current ? (
        <img
          key={current}
          className={styles.image}
          src={current}
          alt={alt}
          decoding="async"
          onError={() => setStage((s) => s + 1)}
        />
      ) : (
        <span className={styles.placeholder} aria-hidden="true">
          ▣
        </span>
      )}
      <p className={styles.hint} aria-hidden="true">
        Pinch or swipe-back to close
      </p>
    </div>
  );
}
