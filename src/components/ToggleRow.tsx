import { useEffect, useRef } from "react";
import styles from "./ToggleRow.module.css";

/**
 * A standalone focusable on/off row for screens that need a mode switch outside
 * their FocusList (MenuRow only works as a FocusList child). Like BackRow it
 * activates on the index-finger pinch, never the reserved middle-finger pinch.
 */
export function ToggleRow({
  label,
  hint,
  on,
  focused,
  onActivate,
}: {
  label: string;
  hint?: string;
  on: boolean;
  focused: boolean;
  onActivate: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "nearest" });
  }, [focused]);

  return (
    <button
      ref={ref}
      type="button"
      className={`${styles.row} ${focused ? styles.focused : ""} ${on ? styles.on : ""}`}
      role="switch"
      aria-checked={on}
      aria-selected={focused}
      onClick={onActivate}
    >
      <span className={styles.label}>{label}</span>
      {hint ? <span className={styles.hint}>{hint}</span> : null}
    </button>
  );
}
