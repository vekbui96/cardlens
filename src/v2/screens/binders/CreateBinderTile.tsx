import { useState, type FormEvent } from "react";
import { BINDER_FORMATS, specFor, type BinderFormat } from "../../../models/binderLayout.ts";
import { Chip, Row, Stack } from "../../primitives/index.ts";
import styles from "./binders.module.css";

/**
 * The empty slot on the shelf.
 *
 * Last, and shaped like a binder, so it reads as "one more goes here" rather
 * than as a settings panel. The ratio is not close: a binder is created once
 * and opened for weeks, and the layout this replaced gave the rarer action an
 * empty text field, three chips and a disabled button ABOVE everything else,
 * every single visit.
 *
 * With no binders at all it is the only tile on the screen, and so it is its
 * own empty state — which is why there is no separate "No binders yet" notice.
 * The old one sat UNDER the form that answered it.
 */
export function CreateBinderTile({
  onCreate,
  alone,
}: {
  onCreate: (name: string, format: BinderFormat) => void;
  /** True when there is nothing else on the shelf, so it explains itself. */
  alone: boolean;
}) {
  const [name, setName] = useState("");
  const [format, setFormat] = useState<BinderFormat>("9");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    // A silent no-op is the bug: the button is disabled while this is true, so
    // nothing can reach here by pressing it.
    if (!trimmed) return;
    onCreate(trimmed, format);
    setName("");
  };

  return (
    <li className={styles.createTile}>
      <form className={styles.create} onSubmit={submit}>
        <Stack gap={3}>
          <p className={styles.createTitle}>New binder</p>
          {alone ? (
            <p className={styles.createHint}>
              A binder is a layout you arrange yourself — any cards, in any order, including ones you do not
              own yet. Name one to start.
            </p>
          ) : null}

          <input
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name it"
            aria-label="Binder name"
          />

          {/* The group is a plain element around the Row: the layout primitives
              take no ARIA props on purpose, and three chips that are one choice
              have to be announced as one choice. */}
          <div role="group" aria-label="Binder format">
            <Row gap={2} wrap>
              {BINDER_FORMATS.map((f) => (
                <Chip key={f} onPress={() => setFormat(f)} pressed={format === f}>
                  {specFor(f).label}
                </Chip>
              ))}
            </Row>
          </div>

          <div>
            <button type="submit" className={styles.primary} disabled={!name.trim()}>
              Create binder
            </button>
          </div>
        </Stack>
      </form>
    </li>
  );
}
