import { useState, type FormEvent } from "react";
import { Panel, Stack } from "../../primitives/index.ts";
import { extractTcin } from "../../../models/target.ts";
import { addProblem, entryProblem } from "./targetState.ts";
import styles from "./target.module.css";

export interface AddWatchProps {
  /** Runs the add; `onDone` is called only if the bot accepted it. */
  onAdd: (input: { target: string; name?: string }, onDone: () => void) => void;
  pending: boolean;
  /** The last add's failure, if it failed. Turned into words, not a status code. */
  error: unknown;
  /** Why adding is impossible right now, or null. Disables the button and says why. */
  blocked: string | null;
}

/**
 * Watch something new.
 *
 * The entry is validated HERE rather than at the server, because the round trip
 * is the bot's browser walking a real Target product page — up to ninety
 * seconds — and spending that only to be told the text was not a link is a bad
 * trade. The button says so while it runs, for the same reason: an "Add" that
 * sits there for a minute with no explanation reads as a screen that has hung.
 *
 * A success is CONFIRMED rather than merely cleared. A form that empties itself
 * is ambiguous — it looks identical to one that reset because something went
 * wrong — and the watchlist below can be up to a poll behind.
 */
export function AddWatch({ onAdd, pending, error, blocked }: AddWatchProps) {
  const [entry, setEntry] = useState("");
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const tcin = extractTcin(entry);
    const bad = entryProblem(entry, tcin);
    setProblem(bad);
    setConfirmed(null);
    if (bad || !tcin) return;

    const label = name.trim() || `TCIN ${tcin}`;
    onAdd({ target: entry.trim(), ...(name.trim() ? { name: name.trim() } : {}) }, () => {
      setEntry("");
      setName("");
      setConfirmed(label);
    });
  };

  const failed = addProblem(error);

  return (
    <Panel title="Watch something new" headingLevel={2}>
      <form onSubmit={submit}>
        <Stack gap={3}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="v2-target-entry">
              Target product link or TCIN
            </label>
            <input
              id="v2-target-entry"
              className={styles.input}
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              placeholder="target.com/p/…/-/A-89542109"
              autoComplete="off"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="v2-target-name">
              Name (optional — the bot looks it up if this is blank)
            </label>
            <input
              id="v2-target-name"
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
            />
          </div>

          <button type="submit" className={styles.submit} disabled={pending || blocked !== null}>
            {pending ? "Asking Target…" : "Add to watchlist"}
          </button>

          {blocked ? <p className={styles.prose}>{blocked}</p> : null}

          {pending ? (
            <p className={styles.prose}>
              Adding resolves the real product title and a first status through the bot's browser, so it takes
              seconds rather than being instant.
            </p>
          ) : null}

          {problem ? (
            <p className={styles.error} role="alert">
              {problem}
            </p>
          ) : null}

          {failed ? (
            <p className={styles.error} role="alert">
              {failed}
            </p>
          ) : null}

          {confirmed && !pending && !failed ? (
            <p className={styles.ok}>Added {confirmed}. It appears below on the next sweep.</p>
          ) : null}
        </Stack>
      </form>
    </Panel>
  );
}
