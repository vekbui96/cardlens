import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * Combobox behaviour, without any markup.
 *
 * Headless because there are four search boxes across two UI versions with two
 * different stylesheets, and the thing that must not be written four times is
 * not the CSS — it is the keyboard contract. Down/Up/Enter/Escape/Tab and the
 * `aria-activedescendant` bookkeeping are where this pattern is usually got
 * subtly wrong, and where a screen-reader user notices first.
 *
 * See `docs/card-name-autofill.md`.
 */

export interface ComboboxOptions<T> {
  items: T[];
  /** Chosen with Enter or a click. Fills the field; it never submits. */
  onChoose: (item: T) => void;
  /** False while the field is empty or too short to suggest against. */
  enabled?: boolean;
}

export interface Combobox {
  open: boolean;
  /** Index into `items`, or -1 when the typed text is what Enter will use. */
  highlighted: number;
  listId: string;
  optionId: (index: number) => string;
  /** Spread onto the `<input>`. */
  inputProps: {
    role: "combobox";
    "aria-expanded": boolean;
    "aria-controls": string;
    "aria-autocomplete": "list";
    "aria-activedescendant": string | undefined;
    onKeyDown: (e: ReactKeyboardEvent) => void;
    onFocus: () => void;
    onBlur: () => void;
  };
  choose: (index: number) => void;
  close: () => void;
}

export function useCombobox<T>({ items, onChoose, enabled = true }: ComboboxOptions<T>): Combobox {
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const chooseRef = useRef(onChoose);
  chooseRef.current = onChoose;

  const open = focused && !dismissed && enabled && items.length > 0;

  // A new set of suggestions means the old highlight points at a different
  // card. Leaving it would let Enter pick something nobody looked at.
  useEffect(() => setHighlighted(-1), [items]);

  // Typing again after Escape should offer again — dismissal is for the list
  // that was on screen, not for the field forever.
  useEffect(() => setDismissed(false), [items]);

  const choose = useCallback(
    (index: number) => {
      const item = items[index];
      if (item === undefined) return;
      chooseRef.current(item);
      setDismissed(true);
      setHighlighted(-1);
    },
    [items],
  );

  const close = useCallback(() => {
    setDismissed(true);
    setHighlighted(-1);
  }, []);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (!enabled) return;

      if (e.key === "Escape") {
        // Only swallow Escape when there is a list to close. Otherwise it
        // belongs to whatever is above — a sheet, a modal, the picker.
        if (!open) return;
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }

      if (e.key === "Enter") {
        // Nothing highlighted means Enter is a submit, and the form gets it.
        // This is what keeps "typing does not search, submit does" true.
        if (!open || highlighted < 0) return;
        e.preventDefault();
        choose(highlighted);
        return;
      }

      if (e.key === "Tab") {
        if (open) close();
        return;
      }

      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (!open) return;
      // Ours now: without this the caret jumps to one end of the field while
      // the highlight moves, which reads as the text being edited.
      e.preventDefault();
      const last = items.length - 1;
      setHighlighted((current) => {
        if (e.key === "ArrowDown") return current >= last ? -1 : current + 1;
        return current <= -1 ? last : current - 1;
      });
    },
    [enabled, open, highlighted, items.length, choose, close],
  );

  const optionId = useCallback((index: number) => `${listId}-option-${index}`, [listId]);

  return useMemo(
    () => ({
      open,
      highlighted,
      listId,
      optionId,
      choose,
      close,
      inputProps: {
        role: "combobox" as const,
        "aria-expanded": open,
        "aria-controls": listId,
        "aria-autocomplete": "list" as const,
        "aria-activedescendant": open && highlighted >= 0 ? optionId(highlighted) : undefined,
        onKeyDown,
        onFocus: () => setFocused(true),
        // Deferred: a click on a suggestion blurs the input before the click
        // lands, and closing here synchronously would unmount the thing being
        // clicked. A frame is enough, and it is invisible.
        onBlur: () => window.setTimeout(() => setFocused(false), 0),
      },
    }),
    [open, highlighted, listId, optionId, choose, close, onKeyDown],
  );
}
