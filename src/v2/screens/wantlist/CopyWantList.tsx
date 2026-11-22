import { useEffect, useRef, useState } from "react";
import { Chip } from "../../primitives/index.ts";
import { copyLink } from "../../../web/handOverLink.ts";
import { wantListText, type WantListSection } from "./wantListText.ts";
import styles from "./wantlist.module.css";

/**
 * "Copy want list": the list as shown (filters and sort applied), one tap.
 * Absent while sets are still loading or when nothing is shown. When the
 * clipboard refuses, the text goes on screen in a selectable box.
 */
export function CopyWantList({
  sections,
  notLoaded,
  ready,
}: {
  sections: readonly WantListSection[];
  notLoaded: number;
  ready: boolean;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const [text, setText] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const { count } = wantListText(sections, notLoaded);
  if (!ready || count === 0) return null;

  const copy = async () => {
    const list = wantListText(sections, notLoaded);
    setText(list.text);
    const ok = await copyLink(list.text);
    setState(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    if (ok) timer.current = setTimeout(() => setState("idle"), 2500);
  };

  return (
    <>
      <Chip onPress={() => void copy()}>{state === "copied" ? "Want list copied" : "Copy want list"}</Chip>
      {state === "failed" ? (
        <div role="alert">
          <p className={styles.meta}>Copy failed: select and copy the list below.</p>
          <textarea
            className={styles.select}
            readOnly
            rows={8}
            value={text}
            aria-label="Want list"
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      ) : null}
    </>
  );
}
