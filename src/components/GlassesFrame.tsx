import type { ReactNode } from "react";
import styles from "./GlassesFrame.module.css";

interface GlassesFrameProps {
  children: ReactNode;
  /** Show the desktop preview chrome (bezel + label). Off = raw 600x600 (glasses). */
  chrome?: boolean;
  /** Responsive shell for a phone or browser window instead of the fixed square. */
  web?: boolean;
  scale?: number;
  aside?: ReactNode;
}

/**
 * Wraps the 600x600 app. On glasses (`chrome=false`) it renders the surface raw.
 * On desktop it adds a bezel, a size label, and an optional side panel (DevPanel)
 * so the whole experience is testable on Windows.
 */
export function GlassesFrame({ children, chrome = true, web = false, scale = 1, aside }: GlassesFrameProps) {
  if (web) {
    // Overrides --cl-viewport rather than restyling every screen: the screens
    // size themselves from that token, so one variable turns the fixed square
    // into a fluid column and nothing else has to know.
    return <div className={styles.webSurface}>{children}</div>;
  }

  if (!chrome) {
    return <div className={styles.rawSurface}>{children}</div>;
  }

  return (
    <div className={styles.stage}>
      <div className={styles.column}>
        <div className={styles.label}>Meta Ray-Ban Display · 600 × 600 preview</div>
        <div className={styles.bezel} style={{ transform: `scale(${scale})` }}>
          <div className={styles.surface}>{children}</div>
        </div>
        <div className={styles.hint}>Arrows = swipe · Enter = select · Esc = back — or use the panel →</div>
      </div>
      {aside ? <div className={styles.aside}>{aside}</div> : null}
    </div>
  );
}
