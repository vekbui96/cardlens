import { switchUiVersion, type UiVersion } from "../../app/uiVersion.ts";
import styles from "./V2Shell.module.css";

/**
 * Flip between the old UI and the rebuild.
 *
 * It lives in the SHELL of both versions, never inside a screen, for one
 * reason: it has to work when every screen below it is broken. During a rebuild
 * the most likely thing to be broken is the screen you are looking at, and a
 * switch that goes down with it strands you on a white page with no way back
 * except clearing site data.
 *
 * The flip is a full reload rather than a re-render. The two versions have
 * different stylesheets, a different DOM shape, and different assumptions about
 * what is mounted; swapping them in place would leave whichever one lost still
 * holding its listeners.
 */
export function VersionSwitch({ current }: { current: UiVersion }) {
  return (
    <div className={styles.switch} role="group" aria-label="Interface version">
      <Option current={current} value="v1" label="V1" />
      <Option current={current} value="v2" label="V2" />
    </div>
  );
}

function Option({ current, value, label }: { current: UiVersion; value: UiVersion; label: string }) {
  const active = current === value;
  return (
    <button
      type="button"
      className={`${styles.switchOption} ${active ? styles.switchOptionActive : ""}`}
      aria-pressed={active}
      aria-label={`Use interface ${label}`}
      onClick={() => switchUiVersion(value)}
      disabled={active}
    >
      {label}
    </button>
  );
}
