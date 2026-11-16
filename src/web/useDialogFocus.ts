import { useEffect, useRef, type RefObject } from "react";

/**
 * Keyboard focus for a web dialog: focus the panel once when it opens, close on
 * Escape, and hand focus back to whatever opened it when it closes.
 *
 * The panel is focused ONCE, on mount. The effect this replaced depended on
 * `onClose`, and callers pass an inline arrow, so every parent re-render made a
 * new one. Marking a printing re-renders the set screen, so the effect re-ran
 * and pulled focus off the printing button that had just been pressed.
 * `onClose` is read through a ref instead, so the Escape listener always calls
 * the latest one without re-subscribing.
 *
 * Restoring focus matches `WebHeader` and `SetSwitcher`: without it a keyboard
 * or screen-reader user lands on `<body>` and starts again from the top of a
 * 300-card grid. The opener is skipped when it has left the document, or was
 * `<body>` to begin with (Safari does not focus a button on click).
 */
export function useDialogFocus<T extends HTMLElement>(onClose: () => void): RefObject<T> {
  const panel = useRef<T>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener && opener !== document.body && opener.isConnected) {
        opener.focus({ preventScroll: true });
      }
    };
  }, []);

  return panel;
}
