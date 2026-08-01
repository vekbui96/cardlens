import type { ReactNode } from "react";
import { WebHeader } from "../web/shell/WebHeader.tsx";
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
    //
    // data-shell is the isolation seam for the web theme (styles/web-theme.css).
    // Scoping the overrides to this attribute means the glasses and preview
    // shells cannot inherit them by construction, not by discipline — the
    // cascade never reaches them. See e2e/shell-isolation.spec.ts.
    return (
      <div className={styles.webSurface} data-shell="web">
        {/* Global navigation lives in the shell, not in a screen: it must
            survive every screen change and be reachable from all of them. */}
        <WebHeader />
        {children}
      </div>
    );
  }

  if (!chrome) {
    return (
      <div className={styles.rawSurface} data-shell="glasses">
        {children}
      </div>
    );
  }

  return (
    <div className={styles.stage} data-shell="preview">
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
