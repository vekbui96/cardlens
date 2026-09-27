import { forwardRef, type InputHTMLAttributes } from "react";
import styles from "./primitives.module.css";
import { cx } from "./layout.tsx";

/**
 * A single-line text field.
 *
 * This is the primitive Phase 1 proved was missing. Six screens each wrote
 * their own `.input` rule, and the six disagreed in exactly the ways that
 * matter: three drew `--v2-border`, three `--v2-border-strong`; one used
 * `--v2-fs-small` and five `--v2-fs-body`; the paddings were `1/2`, `0/3` and
 * `2/3`; and only one set `box-sizing`. None of that was a decision — it was
 * six people typing a text field from memory.
 *
 * ### The accessible name is not optional
 *
 * A text field with no name is announced as "edit text, blank", which tells a
 * screen-reader user nothing at all. So the type demands one of two things and
 * there is no third: either `label`, which becomes `aria-label`, or `id`,
 * which means a visible `<label htmlFor>` sits beside it. The second is what a
 * form wants — a visible label is better for everyone, not only for a screen
 * reader — and the first is for a search box whose placeholder is its label.
 *
 * TypeScript cannot check that an `id` really has a `<label>` pointing at it,
 * so that half is a convention. Requiring the choice is still worth it: the
 * failure it prevents is passing neither, which is what happens when a field
 * is copied from a screen that had a label into one that does not.
 *
 * ### What it deliberately does not do
 *
 * It does not render the label, the error text or the hint. Those belong to
 * the screen, which knows what it is asking for and where the text goes; a
 * primitive that owns them ends up with a prop per layout. And it is text
 * only — `type` is narrowed to the three that are text fields. A checkbox and
 * a file picker are different controls that happen to share a tag name, and
 * giving them this styling makes them look like something they are not.
 */

type NativeProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "className" | "type" | "size" | "children" | "aria-label" | "id"
>;

interface FieldOwnProps {
  /**
   * `search` gets the browser's clear affordance and the right on-screen
   * keyboard; `password` masks. There is no fourth: see above.
   */
  type?: "text" | "search" | "password";
  /**
   * Take the free space in a `Row` instead of the full width of a `Stack`.
   *
   * Without it a field is `width: 100%`, which is right in a column and wrong
   * beside a button — there it must be the child that gives, and the button
   * the one that keeps its size. `Row`'s own `grow` cannot do this: it gives
   * EVERY child an equal share, so the button would grow too.
   */
  grow?: boolean;
  className?: string;
}

/** Exactly one of these two ways of having a name. */
type FieldName =
  | { label: string; id?: string }
  | {
      label?: undefined;
      /** The `for` of a visible `<label>`. */
      id: string;
    };

export type FieldProps = NativeProps & FieldOwnProps & FieldName;

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { type = "text", grow = false, className, label, id, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cx(styles.field, grow && styles.fieldGrow, className)}
      {...(id ? { id } : {})}
      {...(label ? { "aria-label": label } : {})}
      {...rest}
    />
  );
});
