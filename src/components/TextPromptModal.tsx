import { useEffect, useRef, useState } from "react";
import type { TextInputRequest } from "../models/text-input.ts";
import { useIsWeb } from "../app/contexts.tsx";
import styles from "./Modal.module.css";

interface TextPromptModalProps {
  request: TextInputRequest;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/**
 * Browser text entry (desktop/mobile). Uses a real input so arrow keys / Enter /
 * Escape belong to the field — the Meta adapter ignores editable targets, so
 * navigation is not hijacked. On glasses this provider isn't selected (no
 * keyboard); the companion flow is used instead.
 */
export function TextPromptModal({ request, onSubmit, onCancel }: TextPromptModalProps) {
  const [value, setValue] = useState(request.initialValue ?? "");
  const isWeb = useIsWeb();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed) onSubmit(trimmed);
  };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={request.title}>
      <div className={styles.panel}>
        <h2 className={styles.title}>{request.title}</h2>
        <input
          ref={inputRef}
          className={styles.input}
          type="text"
          value={value}
          placeholder={request.placeholder}
          aria-label={request.placeholder}
          /*
           * Phone keyboard behaviour. Autocorrect is actively harmful here —
           * it "fixes" Pokémon names and set codes into English words — and the
           * return key should say Search rather than Go.
           */
          enterKeyHint="search"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
        />
        {/* A touchscreen has no Escape key, so naming one is noise. */}
        <p className={styles.hint}>
          {isWeb ? "Type a Pokémon name." : "Type a Pokémon name. Enter to search, Esc to cancel."}
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={submit}>
            Search
          </button>
        </div>
      </div>
    </div>
  );
}
