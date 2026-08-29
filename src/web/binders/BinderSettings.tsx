import { useId, useState } from "react";
import { BINDER_FORMATS, reformat, setShowValue, specFor, type Binder } from "../../models/binderLayout.ts";
import { BinderTradeBar } from "./BinderTradeBar.tsx";
import styles from "./WebBinderScreen.module.css";

/**
 * Everything about the binder ITSELF, behind one disclosure.
 *
 * The controls row used to carry two different kinds of thing side by side:
 * actions you take over and over while laying a binder out (add a page, remove
 * one) and settings you set once and forget (how many pockets, whether it is
 * priced on the list, whether it is offered for trade). Six chips of equal
 * weight, and the ones you press constantly were the hardest to find among
 * them.
 *
 * So the settings move in here and the page actions stay out there. Collapsed
 * by default, because the binder is the content and a phone has no vertical
 * space to spend on controls nobody is touching — and because every one of
 * these is a decision you make once.
 *
 * Not a modal. Changing the format re-flows the pages and marking the binder
 * for trade changes what every pocket shows, so you want the binder visible
 * underneath while you do it — a dialog would cover the thing being configured.
 */
export function BinderSettings({ binder, onSave }: { binder: Binder; onSave: (binder: Binder) => void }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <>
      <div className={styles.controls}>
        <button
          type="button"
          className={`${styles.chip} ${open ? styles.chipOn : ""}`}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
        >
          Settings
        </button>
        {/* The state worth seeing without opening the panel: both change what
            the binder DOES, and a binder quietly still on offer is the one you
            would want to notice from here. */}
        {binder.forTrade ? <span className={styles.settingTag}>For trade</span> : null}
        {binder.showValue ? <span className={styles.settingTag}>Priced in list</span> : null}
      </div>

      {open ? (
        <div className={styles.settings} id={panelId}>
          <div className={styles.settingRow}>
            <span className={styles.settingLabel} id={`${panelId}-format`}>
              Pocket size
            </span>
            {/* Re-flows the pages in reading order — positions cannot survive,
                because a 2-wide page has no pocket matching the 9th of a
                3-wide one. Kept here rather than out on the toolbar: it is a
                property of the binder you own, not a step in filling it. */}
            <div className={styles.settingControls} role="group" aria-labelledby={`${panelId}-format`}>
              {BINDER_FORMATS.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`${styles.chip} ${binder.format === f ? styles.chipOn : ""}`}
                  aria-pressed={binder.format === f}
                  onClick={() => onSave(reformat(binder, f, Date.now()))}
                >
                  {specFor(f).label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.settingRow}>
            <span className={styles.settingLabel} id={`${panelId}-list`}>
              In the list
            </span>
            <div className={styles.settingControls} role="group" aria-labelledby={`${panelId}-list`}>
              {/* Off by default. Pricing a binder is a request per set it
                  spans, and the binders list asks for nothing otherwise — so
                  this is opt-in on the binders that represent money rather than
                  on all of them. */}
              <button
                type="button"
                className={`${styles.chip} ${binder.showValue ? styles.chipOn : ""}`}
                aria-pressed={Boolean(binder.showValue)}
                onClick={() => onSave(setShowValue(binder, !binder.showValue, Date.now()))}
              >
                {binder.showValue ? "✓ Show value" : "Show value"}
              </button>
            </div>
          </div>

          <BinderTradeBar binder={binder} onSave={onSave} />

          <p className={styles.settingNote}>
            These stay with the binder and sync to your other devices. Adding and removing pages is up on the
            toolbar, next to the binder itself.
          </p>
        </div>
      ) : null}
    </>
  );
}
