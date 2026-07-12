import { useEffect, useRef, type ReactNode } from "react";
import styles from "./FocusList.module.css";

interface FocusListProps<T> {
  items: T[];
  focusIndex: number;
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, state: { focused: boolean; index: number }) => ReactNode;
  ariaLabel: string;
  /** Called when a row is activated by pointer/click (parity with SELECT). */
  onActivate?: (index: number) => void;
}

/**
 * Accessible listbox with a single focus ring. The focused row is scrolled into
 * view programmatically (the glasses have no user scroll — focus drives it).
 */
export function FocusList<T>({
  items,
  focusIndex,
  getKey,
  renderItem,
  ariaLabel,
  onActivate,
}: FocusListProps<T>) {
  const focusedRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    focusedRef.current?.scrollIntoView({ block: "nearest" });
  }, [focusIndex]);

  return (
    <ul
      className={styles.list}
      role="listbox"
      aria-label={ariaLabel}
      aria-activedescendant={`opt-${focusIndex}`}
    >
      {items.map((item, index) => {
        const focused = index === focusIndex;
        return (
          <li
            key={getKey(item, index)}
            id={`opt-${index}`}
            role="option"
            aria-selected={focused}
            ref={focused ? focusedRef : null}
            className={`${styles.row} ${focused ? styles.focused : ""}`}
            onClick={() => onActivate?.(index)}
          >
            {renderItem(item, { focused, index })}
          </li>
        );
      })}
    </ul>
  );
}
