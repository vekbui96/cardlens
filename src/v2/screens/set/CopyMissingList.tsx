import { useEffect, useRef, useState } from "react";
import { Chip } from "../../primitives/index.ts";
import { copyLink } from "../../../web/handOverLink.ts";
import { missingListText, type MissingListSlot } from "../../../web/sets/missingListText.ts";
import styles from "./set.module.css";

/**
 * "Copy missing list": the set's want list as plain text, one tap.
 *
 * Fed ALL of the set's slots, not the filtered ones: the list answers "what does
 * this set still need", whichever filter happens to be on. Absent until there is
 * something to copy, because a chip that can only say "nothing" is noise. When the
 * clipboard refuses (iOS Safari outside a fresh tap) the text goes on screen in a
 * selectable box, like the share buttons do, rather than the tap doing nothing.
 */
export function CopyMissingList({
  slots,
  priceFor,
  setName,
  printingsKnown,
}: {
  slots: readonly MissingListSlot[];
  priceFor: (collectorNumber: string, finish: string) => number | undefined;
  setName: string;
  printingsKnown: boolean;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const [text, setText] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const { count } = missingListText(slots, priceFor, setName);
  if (!printingsKnown || count === 0) return null;

  const copy = async () => {
    const list = missingListText(slots, priceFor, setName);
    setText(list.text);
    const ok = await copyLink(list.text);
    setState(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    if (ok) timer.current = setTimeout(() => setState("idle"), 2500);
  };

  return (
    <>
      <Chip onPress={() => void copy()}>
        {state === "copied" ? "Missing list copied" : "Copy missing list"}
      </Chip>
      {state === "failed" ? (
        <div className={styles.listFallback} role="alert">
          <p className={styles.summary}>Copy failed: select and copy the list below.</p>
          <textarea
            className={styles.listBox}
            readOnly
            rows={8}
            value={text}
            aria-label="Missing list"
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      ) : null}
    </>
  );
}
