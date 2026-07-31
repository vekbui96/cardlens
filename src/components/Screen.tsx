import type { ReactNode } from "react";
import styles from "./Screen.module.css";

interface ScreenProps {
  title: string;
  children: ReactNode;
  /** Optional hint shown under the title (e.g. instructions). */
  subtitle?: string;
  /** Shows a "back" affordance hint when the user can go back. */
  canGoBack?: boolean;
  /**
   * Compact header: the control (usually BackRow) and a status string share one
   * row with the title instead of stacking title over subtitle. On a 600x600
   * display a stacked header costs roughly two card rows of list, which matters
   * most on the screens people scroll for a long time.
   */
  headerLeft?: ReactNode;
  headerRight?: ReactNode;
}

/** Standard screen frame: fixed 600x600, dark, high-contrast header + body. */
export function Screen({ title, subtitle, children, headerLeft, headerRight }: ScreenProps) {
  // `canGoBack` is accepted for compatibility but the affordance is now the
  // visible BackRow control that screens render themselves.
  const compact = headerLeft !== undefined || headerRight !== undefined;

  return (
    <section className={styles.screen} aria-label={title}>
      <header className={compact ? styles.headerCompact : styles.header}>
        {compact ? (
          <>
            {headerLeft}
            <h1 className={styles.titleCompact}>{title}</h1>
            {headerRight ? <span className={styles.headerStatus}>{headerRight}</span> : null}
          </>
        ) : (
          <>
            <h1 className={styles.title}>{title}</h1>
            {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
          </>
        )}
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
