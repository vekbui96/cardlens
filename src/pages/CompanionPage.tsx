import { useMemo, useState } from "react";
import { CompanionClient } from "../services/companion/client.ts";
import styles from "./CompanionPage.module.css";

type Status = "idle" | "sending" | "sent" | "error";

/**
 * Phone-facing companion input page at /input/:code. The user types a card name
 * here (real keyboard) and it is relayed to their glasses session. No account,
 * short-lived session, only the search text is transmitted.
 */
export function CompanionPage() {
  const code = useMemo(() => {
    const match = window.location.pathname.match(/\/input\/([^/]+)/);
    return (match?.[1] ?? "").toUpperCase().slice(0, 12);
  }, []);
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const client = useMemo(() => new CompanionClient(), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    setStatus("sending");
    const ok = await client.submit(code, trimmed);
    setStatus(ok ? "sent" : "error");
  };

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>CardLens</h1>
        <p className={styles.subtitle}>
          Session <strong className={styles.code}>{code || "—"}</strong>
        </p>

        {status === "sent" ? (
          <div className={styles.done} role="status">
            <p className={styles.big}>Sent!</p>
            <p className={styles.hint}>Check your glasses — results are loading.</p>
            <button
              className={styles.secondary}
              onClick={() => {
                setValue("");
                setStatus("idle");
              }}
            >
              Send another
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className={styles.form}>
            <label htmlFor="q" className={styles.label}>
              Pokémon card name
            </label>
            <input
              id="q"
              className={styles.input}
              type="text"
              inputMode="text"
              autoFocus
              autoComplete="off"
              maxLength={100}
              placeholder="e.g. Charizard ex"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            {status === "error" ? (
              <p className={styles.error} role="alert">
                Couldn’t send — the session may have expired. Reopen the code on your glasses.
              </p>
            ) : null}
            <button className={styles.primary} type="submit" disabled={status === "sending" || !value.trim()}>
              {status === "sending" ? "Sending…" : "Send to glasses"}
            </button>
          </form>
        )}

        <p className={styles.privacy}>
          Only the text you type is sent. The session expires shortly. <a href="/privacy">Privacy</a>
        </p>
      </div>
    </main>
  );
}
