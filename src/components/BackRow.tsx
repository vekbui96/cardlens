import { useEffect, useRef } from "react";
import styles from "./BackRow.module.css";

/**
 * Visible, focusable Back control. Reliable on the glasses because it uses the
 * index-finger pinch (SELECT), not the reserved middle-finger pinch.
 */
export function BackRow({ focused, onActivate }: { focused: boolean; onActivate: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "nearest" });
  }, [focused]);

  return (
    <button
      ref={ref}
      type="button"
      className={`${styles.back} ${focused ? styles.focused : ""}`}
      aria-label="Back"
      aria-selected={focused}
      onClick={onActivate}
    >
      ‹ Back
    </button>
  );
}
