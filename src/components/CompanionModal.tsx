import { useEffect, useRef, useState } from "react";
import type { TextInputRequest } from "../models/text-input.ts";
import { CompanionClient } from "../services/companion/client.ts";
import { useWearableInput } from "../hooks/useWearableInput.ts";
import styles from "./Modal.module.css";

interface CompanionModalProps {
  request: TextInputRequest;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  client?: CompanionClient;
}

type Phase = "connecting" | "waiting" | "error";

/**
 * Companion-phone entry. Shows a short session code + URL; the user types on their
 * phone at /input/CODE and the value arrives via the relay (short polling). BACK
 * (middle-finger pinch / Escape) cancels.
 */
export function CompanionModal({ request, onSubmit, onCancel, client }: CompanionModalProps) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [code, setCode] = useState<string>("");
  const clientRef = useRef(client ?? new CompanionClient());

  useWearableInput((e) => {
    if (e.type === "BACK") onCancel();
  });

  useEffect(() => {
    const controller = new AbortController();
    const c = clientRef.current;
    let active = true;

    (async () => {
      try {
        const session = await c.createSession(controller.signal);
        if (!active) return;
        setCode(session.code);
        setPhase("waiting");
        const value = await c.waitForInput(session.code, { signal: controller.signal });
        if (!active) return;
        if (value) onSubmit(value);
        else onCancel();
      } catch {
        if (active) setPhase("error");
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [onSubmit, onCancel]);

  const url = typeof window !== "undefined" ? `${window.location.origin}/input/${code}` : `/input/${code}`;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={request.title}>
      <div className={styles.panel}>
        <h2 className={styles.title}>Type on your phone</h2>
        {phase === "connecting" ? <p className={styles.status}>Connecting…</p> : null}

        {phase === "waiting" ? (
          <>
            <p className={styles.hint}>Open this on your phone and enter a card name:</p>
            <div className={styles.code} aria-label={`Session code ${code.split("").join(" ")}`}>
              {code}
            </div>
            <p className={styles.url}>{url}</p>
            <p className={styles.status} role="status" aria-live="polite">
              Waiting for your phone…
            </p>
          </>
        ) : null}

        {phase === "error" ? (
          <p className={styles.status}>Companion service is unavailable. Use Recent or Popular instead.</p>
        ) : null}

        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
