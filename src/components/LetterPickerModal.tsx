import { useEffect, useMemo, useState } from "react";
import type { TextInputRequest } from "../models/text-input.ts";
import type { WearableInputEvent } from "../models/input.ts";
import { useWearableInput } from "../hooks/useWearableInput.ts";
import { suggestPokemon } from "../features/type-on-glasses/pokemonNames.ts";
import styles from "./LetterPickerModal.module.css";

interface LetterPickerModalProps {
  request: TextInputRequest;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  /** Optional hand-off to the phone companion (shown as a key). */
  onUsePhone?: () => void;
}

type Cell =
  | { kind: "letter"; label: string }
  | { kind: "space"; label: string }
  | { kind: "backspace"; label: string }
  | { kind: "clear"; label: string }
  | { kind: "search"; label: string }
  | { kind: "phone"; label: string };

const LETTER_ROWS = ["ABCDEFG", "HIJKLMN", "OPQRSTU", "VWXYZ"].map((r) =>
  r.split("").map((ch): Cell => ({ kind: "letter", label: ch })),
);

type Focus = { zone: "suggestions" | "keys"; row: number; col: number };

/**
 * On-glasses text entry with no keyboard: a 2D A–Z grid + Space/⌫/Clear/Search
 * driven purely by documented D-pad input (swipes move the cursor, index-pinch
 * selects, middle-pinch cancels). A live suggestions strip lets you pick a
 * Pokémon name after a couple of letters instead of spelling it out.
 */
export function LetterPickerModal({ request, onSubmit, onCancel, onUsePhone }: LetterPickerModalProps) {
  const [query, setQuery] = useState(request.initialValue ?? "");
  const [focus, setFocus] = useState<Focus>({ zone: "keys", row: 0, col: 0 });

  const suggestions = useMemo(() => suggestPokemon(query, 5), [query]);

  const keyRows = useMemo<Cell[][]>(() => {
    const specials: Cell[] = [
      { kind: "space", label: "␣ Space" },
      { kind: "backspace", label: "⌫" },
      { kind: "clear", label: "Clear" },
      { kind: "search", label: "Search" },
    ];
    if (onUsePhone) specials.push({ kind: "phone", label: "☎ Phone" });
    return [...LETTER_ROWS, specials];
  }, [onUsePhone]);

  // If we're focused on suggestions but they disappear, drop back to the keys.
  useEffect(() => {
    if (focus.zone === "suggestions" && suggestions.length === 0) {
      setFocus({ zone: "keys", row: 0, col: 0 });
    }
  }, [focus.zone, suggestions.length]);

  const activate = (cell: Cell) => {
    switch (cell.kind) {
      case "letter":
        setQuery((q) => q + cell.label.toLowerCase());
        break;
      case "space":
        setQuery((q) => (q.length ? q + " " : q));
        break;
      case "backspace":
        setQuery((q) => q.slice(0, -1));
        break;
      case "clear":
        setQuery("");
        break;
      case "search": {
        const trimmed = query.trim();
        if (trimmed) onSubmit(trimmed);
        break;
      }
      case "phone":
        onUsePhone?.();
        break;
    }
  };

  const handle = (event: WearableInputEvent) => {
    setFocus((f) => {
      const clampCol = (row: Cell[], col: number) => Math.max(0, Math.min(row.length - 1, col));
      if (f.zone === "suggestions") {
        switch (event.type) {
          case "SWIPE_LEFT":
            return { ...f, col: Math.max(0, f.col - 1) };
          case "SWIPE_RIGHT":
            return { ...f, col: Math.min(suggestions.length - 1, f.col + 1) };
          case "SWIPE_DOWN":
            return { zone: "keys", row: 0, col: clampCol(keyRows[0], f.col) };
          default:
            return f;
        }
      }
      // keys zone
      switch (event.type) {
        case "SWIPE_UP":
          if (f.row === 0 && suggestions.length > 0) {
            return { zone: "suggestions", row: 0, col: Math.min(suggestions.length - 1, f.col) };
          }
          return { ...f, row: Math.max(0, f.row - 1), col: clampCol(keyRows[Math.max(0, f.row - 1)], f.col) };
        case "SWIPE_DOWN": {
          const row = Math.min(keyRows.length - 1, f.row + 1);
          return { ...f, row, col: clampCol(keyRows[row], f.col) };
        }
        case "SWIPE_LEFT":
          return { ...f, col: Math.max(0, f.col - 1) };
        case "SWIPE_RIGHT":
          return { ...f, col: Math.min(keyRows[f.row].length - 1, f.col + 1) };
        default:
          return f;
      }
    });

    if (event.type === "SELECT") {
      if (focus.zone === "suggestions") {
        const value = suggestions[focus.col];
        if (value) onSubmit(value);
      } else {
        activate(keyRows[focus.row][focus.col]);
      }
    } else if (event.type === "BACK") {
      onCancel();
    }
  };

  useWearableInput(handle);

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={request.title}>
      <div className={styles.panel}>
        <div className={styles.queryBar}>
          <span className={styles.query} aria-live="polite">
            {query || <span className={styles.placeholder}>{request.placeholder}</span>}
            <span className={styles.caret} aria-hidden="true" />
          </span>
        </div>

        {suggestions.length > 0 ? (
          <ul className={styles.suggestions} role="listbox" aria-label="Suggestions">
            {suggestions.map((name, i) => {
              const on = focus.zone === "suggestions" && focus.col === i;
              return (
                <li
                  key={name}
                  role="option"
                  aria-selected={on}
                  className={`${styles.chip} ${on ? styles.chipFocused : ""}`}
                  onClick={() => onSubmit(name)}
                >
                  {name}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={styles.suggestHint}>Type 2+ letters for suggestions</p>
        )}

        <div className={styles.grid} role="grid" aria-label="On-screen keyboard">
          {keyRows.map((row, r) => (
            <div className={styles.gridRow} role="row" key={r}>
              {row.map((cell, c) => {
                const on = focus.zone === "keys" && focus.row === r && focus.col === c;
                return (
                  <button
                    type="button"
                    role="gridcell"
                    aria-selected={on}
                    key={`${r}-${c}`}
                    className={`${styles.key} ${cell.kind !== "letter" ? styles.keyWide : ""} ${on ? styles.keyFocused : ""}`}
                    onClick={() => activate(cell)}
                  >
                    {cell.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <p className={styles.hint}>Swipe to move · pinch to select · middle-pinch to cancel</p>
      </div>
    </div>
  );
}
