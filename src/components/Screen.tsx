import type { ReactNode } from "react";
import styles from "./Screen.module.css";

interface ScreenProps {
  title: string;
  children: ReactNode;
  /** Optional hint shown under the title (e.g. instructions). */
  subtitle?: string;
  /** Shows a "back" affordance hint when the user can go back. */
  canGoBack?: boolean;
}

/** Standard screen frame: fixed 600x600, dark, high-contrast header + body. */
export function Screen({ title, subtitle, children, canGoBack }: ScreenProps) {
  return (
    <section className={styles.screen} aria-label={title}>
      <header className={styles.header}>
        <h1 className={styles.title}>{title}</h1>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
        {canGoBack ? (
          <p className={styles.backHint} aria-hidden="true">
            ‹ Back: middle-finger pinch
          </p>
        ) : null}
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
