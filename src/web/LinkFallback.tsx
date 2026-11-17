import { useState } from "react";
import { copyLink } from "./handOverLink.ts";
import styles from "./LinkFallback.module.css";

/**
 * The link itself, for when the browser would neither share nor copy it.
 *
 * Shown only after `handOverLink` returned `failed`. The Copy button is a
 * fresh tap, so it carries the user activation the original one lost waiting
 * for the server; if even that is refused, the field selects itself on focus
 * so the link can be copied by hand. Never a dead end, never silence.
 */
export function LinkFallback({ url, label }: { url: string; label: string }) {
  const [copied, setCopied] = useState<boolean | null>(null);

  return (
    <div className={styles.fallback} role="alert">
      <p className={styles.text}>
        Your browser would not share or copy the link. Here it is — copy it from here.
      </p>
      <input
        className={styles.field}
        type="text"
        readOnly
        value={url}
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
      />
      <button
        type="button"
        className={styles.copy}
        onClick={() => void copyLink(url).then((ok) => setCopied(ok))}
      >
        {copied ? "Copied" : "Copy link"}
      </button>
      {copied === false ? (
        <p className={styles.text}>Copying was refused too — select the link above and copy it.</p>
      ) : null}
    </div>
  );
}
