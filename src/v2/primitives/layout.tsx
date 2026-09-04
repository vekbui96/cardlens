import type { CSSProperties, ElementType, ReactNode } from "react";
import styles from "./primitives.module.css";
import { cardWidth, space, type Align, type CardWidth, type Justify, type Space } from "./tokens.ts";

/**
 * The three layout primitives. Between them they cover every arrangement in
 * v2, and a screen that reaches past them for a bare `<div style={{display:
 * "flex"}}>` is a screen that has started inventing its own spacing scale.
 */

/** Local custom properties the CSS module consumes. Not part of the public API. */
type Vars = CSSProperties & Record<`--${string}`, string>;

interface StackProps {
  children: ReactNode;
  /** Gap between children, as a step on the 4px scale. */
  gap?: Space;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
}

/** A column. The default arrangement for almost everything. */
export function Stack({ children, gap = 3, as: As = "div", className, style }: StackProps) {
  const vars: Vars = { ...style, "--gap": space(gap) };
  return (
    <As className={cx(styles.stack, className)} style={vars}>
      {children}
    </As>
  );
}

interface RowProps extends StackProps {
  align?: Align;
  justify?: Justify;
  wrap?: boolean;
  /** Give every child an equal share of the width. */
  grow?: boolean;
}

/** A line. Wraps by default off, because silent wrapping hides overflow bugs. */
export function Row({
  children,
  gap = 3,
  align = "center",
  justify = "start",
  wrap = false,
  grow = false,
  as: As = "div",
  className,
  style,
}: RowProps) {
  const vars: Vars = {
    ...style,
    "--gap": space(gap),
    "--align": align === "start" || align === "end" ? `flex-${align}` : align,
    "--justify": justify === "start" || justify === "end" ? `flex-${justify}` : justify,
  };
  return (
    <As className={cx(styles.row, wrap && styles.wrap, grow && styles.grow, className)} style={vars}>
      {children}
    </As>
  );
}

interface GridProps {
  children: ReactNode;
  /**
   * The narrowest a column may be before the grid drops one. Expressed as a
   * card size, not a length: nearly every grid in this app is a grid OF cards,
   * and the ones that are not still want to line up with the ones that are.
   */
  min?: CardWidth;
  gap?: Space;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
}

/**
 * An `auto-fill` grid of equal columns.
 *
 * `auto-fill` rather than `auto-fit` deliberately: auto-fit collapses the empty
 * tracks and stretches whatever is left, so a shelf holding a single binder
 * drew that binder full-bleed across a 1440px window. auto-fill keeps the empty
 * tracks, and one tile stays tile-sized.
 */
export function Grid({ children, min = "pocket", gap = 3, as: As = "div", className, style }: GridProps) {
  const vars: Vars = { ...style, "--gap": space(gap), "--min": cardWidth(min) };
  return (
    <As className={cx(styles.grid, className)} style={vars}>
      {children}
    </As>
  );
}

/** Visible to assistive technology, not to the eye. */
export function ScreenReaderOnly({ children }: { children: ReactNode }) {
  return <span className={styles.srOnly}>{children}</span>;
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
