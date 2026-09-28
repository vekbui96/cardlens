import { forwardRef, type SelectHTMLAttributes } from "react";
import styles from "./primitives.module.css";
import { cx } from "./layout.tsx";

/**
 * A dropdown, drawn by us rather than by the operating system.
 *
 * The second primitive this codebase learned the same way `Field` did: two
 * screens had a `<select>` and the two disagreed. The binder picker gave its
 * one a border and a surface; the scan picker's was grouped in a rule with
 * `.pickList` — `list-style: none; display: flex; max-height: 40vh; overflow:
 * auto` — as though a select were a list, which stripped its padding and left
 * the bare OS control in the middle of a dark panel.
 *
 * ### Why `appearance: none`
 *
 * The native control is painted by the platform: on Windows a light-grey box
 * with its own chevron, sitting in a panel whose every other control is dark
 * and agrees with `Field`. It is the single most obviously foreign thing in
 * the binder's side panel. The list that drops DOWN is still the platform's —
 * that part cannot be styled and should not be, because it is the part a
 * person's OS settings and assistive technology already know how to handle.
 *
 * ### What it deliberately does not do
 *
 * It is not a combobox and it does not filter. A select with 174 options is
 * the right control when the options are a closed set you scan rather than
 * type — which is what a set list is. Anything needing search is `Field` plus
 * `useCombobox`, which already exists.
 */

type NativeProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "className" | "size" | "aria-label" | "id">;

interface SelectOwnProps {
  /** Take the free space in a `Row`; see `Field`'s `grow` for why Row's cannot. */
  grow?: boolean;
  className?: string;
}

/** The same rule as `Field`: a control with no name is a control nobody can use. */
type SelectName =
  | { label: string; id?: string }
  | {
      label?: undefined;
      /** The `for` of a visible `<label>`. */
      id: string;
    };

export type SelectProps = NativeProps & SelectOwnProps & SelectName;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { grow = false, className, label, id, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cx(styles.select, grow && styles.selectGrow, className)}
      {...(id ? { id } : {})}
      {...(label ? { "aria-label": label } : {})}
      {...rest}
    >
      {children}
    </select>
  );
});
