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
export function Screen({ title, subtitle, children }: ScreenProps) {
  // `canGoBack` is accepted for compatibility but the affordance is now the
  // visible BackRow control that screens render themselves.
  return (
    <section className={styles.screen} aria-label={title}>
      <header className={styles.header}>
        <h1 className={styles.title}>{title}</h1>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
