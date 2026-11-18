import { useState } from "react";
import type { Binder, BinderSlot } from "../../models/binderLayout.ts";
import { binderToText } from "../../models/binderToText.ts";
import { copyLink } from "../handOverLink.ts";
import styles from "./WebBinderScreen.module.css";

/**
 * "Copy list": the binder as plain text for a trade chat or forum post.
 *
 * Read-only, and never silent: when the clipboard refuses, the text is put on
 * screen in a box that selects itself, so it can be copied by hand. Prices are
 * included only once they have loaded, so a half-priced list is never copied.
 */
export function BinderCopyList({
  binder,
  priceFor,
  pricesReady,
}: {
  binder: Binder;
  priceFor: (slot: BinderSlot) => number | undefined;
  pricesReady: boolean;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const [text, setText] = useState("");

  const copy = async () => {
    const { text: list } = binderToText(binder, priceFor, pricesReady);
    setText(list);
    const ok = await copyLink(list);
    setState(ok ? "copied" : "failed");
    if (ok) setTimeout(() => setState("idle"), 2500);
  };

  return (
    <div className={styles.copyList}>
      <button type="button" className={styles.chip} onClick={() => void copy()}>
        {state === "copied" ? "List copied" : "Copy list"}
      </button>
      {state === "failed" ? (
        <div role="alert">
          <p className={styles.settingNote}>Copy failed: select and copy the list below.</p>
          <textarea
            className={styles.copyListBox}
            readOnly
            rows={8}
            value={text}
            aria-label="Binder list"
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      ) : null}
    </div>
  );
}
