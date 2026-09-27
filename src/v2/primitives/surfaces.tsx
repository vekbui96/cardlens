import type { CSSProperties, MouseEvent, ReactNode } from "react";
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
  /**
   * Renders an anchor instead, for anything that has a real URL.
   *
   * Give it ALONGSIDE `onPress` when the destination is a route this app
   * handles itself: the Card is then a real link — middle-clickable,
   * copyable, shown in the status bar — that still routes in-page on a plain
   * click. Phase 1 had three tiles (the binder shelf, a search result, an
   * owned row) rendered as buttons for want of this, each of them a link that
   * could not be opened in a new tab.
   */
  href?: string;
  label?: string;
  /**
   * Whether this Card is the chosen one.
   *
   * On a button it is a TOGGLE state, so `false` is as meaningful as `true`
   * and both are announced: a toggle that only reports itself when it is on
   * is announced as a plain button the rest of the time, and nothing tells
   * the reader the off state was even available. Pass it only where the Card
   * genuinely has two states; leave it off and no `aria-pressed` is emitted.
   */
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
        {...(onPress
          ? {
              onClick: (event: MouseEvent<HTMLAnchorElement>) => {
                /*
                 * Hand the click back to the browser whenever the person asked
                 * for something other than "go there in this tab" — a modifier
                 * or a non-primary button means new tab, new window or save,
                 * and routing in-page would swallow all three. This is the
                 * whole reason a link is better than a button here, so
                 * intercepting it unconditionally would give the anchor back
                 * its one advantage and then take it away again.
                 */
                if (
                  event.defaultPrevented ||
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                ) {
                  return;
                }
                event.preventDefault();
                onPress();
              },
            }
          : {})}
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
        {...(selected === undefined ? {} : { "aria-pressed": selected })}
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
