import type { CSSProperties, ReactNode } from "react";
import styles from "./primitives.module.css";
import { cx } from "./layout.tsx";
import { space, type Space } from "./tokens.ts";

type Vars = CSSProperties & Record<`--${string}`, string>;

interface PanelProps {
  children: ReactNode;
  /** A heading rendered inside the panel, with its own semantic level. */
  title?: ReactNode;
  /** Rendered opposite the title — a count, a control, a link. */
  aside?: ReactNode;
  headingLevel?: 2 | 3 | 4;
  pad?: Space;
  tone?: "default" | "raised" | "quiet";
  className?: string;
}

/**
 * A bounded region of content.
 *
 * `headingLevel` is a required decision rather than a fixed `<h2>`: a panel
 * nested inside a section is an `<h3>`, and a page whose headings skip a level
 * is a page a screen reader cannot outline. Making it a prop means the caller
 * has to look at where the panel actually sits.
 */
export function Panel({
  children,
  title,
  aside,
  headingLevel = 2,
  pad = 4,
  tone = "default",
  className,
}: PanelProps) {
  const Heading = `h${headingLevel}` as const;
  const vars: Vars = { "--pad": space(pad) };
  return (
    <section
      className={cx(
        styles.panel,
        tone === "raised" && styles.panelRaised,
        tone === "quiet" && styles.panelQuiet,
        className,
      )}
      style={vars}
    >
      {title !== undefined ? (
        <div className={styles.panelHeader}>
          <Heading className={styles.panelTitle}>{title}</Heading>
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

interface CardProps {
  children: ReactNode;
  /**
   * What pressing it does. A Card without one is not rendered as a button —
   * a surface that looks pressable and is not is the single most common way a
   * UI lies, and v1's Home had three of them.
   */
  onPress?: () => void;
  /** Renders an anchor instead, for anything that has a real URL. */
  href?: string;
  label?: string;
  selected?: boolean;
  pad?: Space;
  className?: string;
}

export function Card({ children, onPress, href, label, selected, pad = 3, className }: CardProps) {
  const vars: Vars = { "--pad": space(pad) };
  const cls = cx(styles.card, selected && styles.cardSelected, className);

  if (href !== undefined) {
    return (
      <a
        className={cls}
        style={vars}
        href={href}
        {...(label ? { "aria-label": label } : {})}
        {...(selected ? { "aria-current": "true" as const } : {})}
      >
        {children}
      </a>
    );
  }

  if (onPress) {
    return (
      <button
        type="button"
        className={cls}
        style={vars}
        onClick={onPress}
        {...(label ? { "aria-label": label } : {})}
        {...(selected ? { "aria-pressed": true } : {})}
      >
        {children}
      </button>
    );
  }

  // Inert on purpose: no hover, no pointer, nothing that suggests a press.
  return (
    <div className={cx(styles.panel, className)} style={vars}>
      {children}
    </div>
  );
}
