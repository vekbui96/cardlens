import { useState, type FormEvent } from "react";
import { Chip, Row, Stack } from "../../primitives/index.ts";
import { BINDER_FORMATS, specFor, type BinderFormat } from "../../../models/binderLayout.ts";
import styles from "./binders.module.css";

/**
 * The empty slot on the shelf.
 *
 * Last, and shaped like a binder, so it reads as "one more goes here" rather
 * than as a settings panel across the top. The ratio is not close: a binder is
 * created once and opened for weeks, and v1's original layout gave the rarer
 * action an empty text field, three chips and a disabled button above
 * everything else, on every single visit.
 *
 * With no binders at all it is the only tile on the screen, and that is the
 * empty state — there is no "No binders yet" notice, because such a notice
 * would sit underneath the form that answers it.
 */
export function CreateTile({ onCreate }: { onCreate: (name: string, format: BinderFormat) => void }) {
  const [name, setName] = useState("");
  const [format, setFormat] = useState<BinderFormat>("9");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed, format);
    setName("");
  };

  return (
    <li className={styles.tile}>
      <form className={styles.create} onSubmit={submit}>
        <Stack gap={3}>
          <p className={styles.createTitle}>New binder</p>

          <input
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name it"
            aria-label="Binder name"
          />

          <div role="group" aria-label="Binder format">
            <Row gap={2} wrap>
              {BINDER_FORMATS.map((f) => (
                <Chip key={f} onPress={() => setFormat(f)} pressed={format === f}>
                  {specFor(f).label}
                </Chip>
              ))}
            </Row>
          </div>

          {/*
            Disabled until it has a name, rather than creating "Untitled". A
            binder is found on this shelf by sight and by name; one called
            Untitled is findable by neither, and renaming is a screen away.
          */}
          <button type="submit" className={styles.submit} disabled={!name.trim()}>
            Create binder
          </button>
        </Stack>
      </form>
    </li>
  );
}
