import { useState, type FormEvent } from "react";
import { Screen } from "../../components/Screen.tsx";
import { BackRow } from "../../components/BackRow.tsx";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useRepositories } from "../../app/contexts.tsx";
import { countBinder, emptyBinder, specFor, type BinderFormat } from "../../models/binderLayout.ts";
import styles from "./WebBinderScreen.module.css";

/** Ids only need to be unique on this device — binders do not sync yet. */
function newId(): string {
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Your binders.
 *
 * A binder is a layout, not a second collection: it holds positions, and what
 * you own is answered by the collection at render time. That is why a card you
 * do not have can sit in a pocket and simply render shadowed — the binder is a
 * plan, and planning around gaps is the point.
 */
export function WebBindersScreen() {
  const { pop, push } = useNavigation();
  const repo = useRepositories();
  const [binders, setBinders] = useState(() => repo.getBinders());
  const [name, setName] = useState("");
  const [format, setFormat] = useState<BinderFormat>("9");

  const create = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const binder = emptyBinder(newId(), trimmed, format, Date.now());
    setBinders(repo.saveBinder(binder));
    setName("");
    push({ name: "binder", binderId: binder.id });
  };

  return (
    <Screen title="Binders" headerLeft={<BackRow focused={false} onActivate={pop} />} canGoBack>
      <form className={styles.create} onSubmit={create}>
        <input
          className={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Binder name"
          aria-label="Binder name"
        />
        <div className={styles.formats} role="group" aria-label="Binder format">
          {(["9", "12"] as BinderFormat[]).map((f) => (
            <button
              key={f}
              type="button"
              className={`${styles.chip} ${format === f ? styles.chipOn : ""}`}
              aria-pressed={format === f}
              onClick={() => setFormat(f)}
            >
              {specFor(f).label}
            </button>
          ))}
        </div>
        <button type="submit" className={styles.primary} disabled={!name.trim()}>
          Create binder
        </button>
      </form>

      {binders.length === 0 ? (
        <p className={styles.notice}>
          No binders yet. Name one above — a Vault X 9-pocket or 12-pocket — and start dropping cards into
          pockets.
        </p>
      ) : (
        <ul className={styles.list}>
          {binders.map((binder) => {
            const counts = countBinder(binder);
            return (
              <li key={binder.id}>
                <div className={styles.binderRow}>
                  <button
                    type="button"
                    className={styles.card}
                    style={{ flexDirection: "column", alignItems: "flex-start" }}
                    onClick={() => push({ name: "binder", binderId: binder.id })}
                  >
                    <span className={styles.binderName}>{binder.name}</span>
                    <span className={styles.binderMeta}>
                      {specFor(binder.format).label} · {counts.filled}/{counts.pockets} filled ·{" "}
                      {binder.pages.length} page{binder.pages.length === 1 ? "" : "s"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={styles.danger}
                    onClick={() => setBinders(repo.deleteBinder(binder.id))}
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Screen>
  );
}
