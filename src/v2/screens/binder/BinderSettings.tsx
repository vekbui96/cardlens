import { Chip } from "../../primitives/index.ts";
import {
  BINDER_FORMATS,
  reformat,
  setForTrade,
  setShowValue,
  specFor,
  type Binder,
} from "../../../models/binderLayout.ts";
import styles from "./binder.module.css";

/** The id the toolbar's Settings button points `aria-controls` at. */
export const SETTINGS_PANEL_ID = "v2-binder-settings";

/**
 * Everything about the binder ITSELF, behind one disclosure.
 *
 * The toolbar used to carry two different kinds of thing side by side: actions
 * taken over and over while laying a binder out (add a page, remove one) and
 * settings set once and forgotten (how many pockets, whether it is priced on the
 * shelf, whether it is offered for trade). Six controls of equal weight, and the
 * ones pressed constantly were the hardest to find among them.
 *
 * The BUTTON that opens this lives in the screen's own toolbar rather than here,
 * with the tags for whatever is switched on beside it. A component that drew its
 * own trigger put a second row of chrome under the first — visible in the very
 * first snapshot of this screen, two rows of buttons using a tenth of a 1440px
 * window before the binder started.
 *
 * Not a modal. Changing the format re-flows the pages and marking the binder for
 * trade changes what every pocket shows, so the binder has to stay visible
 * underneath — a dialog would cover the thing being configured.
 */
export function BinderSettings({
  binder,
  open,
  onSave,
}: {
  binder: Binder;
  open: boolean;
  onSave: (binder: Binder) => void;
}) {
  const panelId = SETTINGS_PANEL_ID;
  const formatId = `${panelId}-format`;
  const listId = `${panelId}-list`;
  const tradeId = `${panelId}-trade`;

  if (!open) return null;

  return (
    <div className={styles.settings} id={panelId}>
      <div className={styles.settingRow}>
        <span className={styles.settingLabel} id={formatId}>
          Pocket size
        </span>
        {/* Re-flows the pages in READING ORDER — positions cannot survive,
                because a 4-wide page has no pocket matching the 9th of a 3-wide
                one. The cover is left alone: it is not contents. */}
        <div className={styles.settingControls} role="group" aria-labelledby={formatId}>
          {BINDER_FORMATS.map((format) => (
            <Chip
              key={format}
              onPress={() => onSave(reformat(binder, format, Date.now()))}
              pressed={binder.format === format}
              tone={binder.format === format ? "accent" : "default"}
            >
              {specFor(format).label}
            </Chip>
          ))}
        </div>
      </div>

      <div className={styles.settingRow}>
        <span className={styles.settingLabel} id={listId}>
          In the list
        </span>
        {/* Off by default. Pricing a binder is a request per SET it spans —
                the Riolu binder alone spans thirty — and the shelf asks for
                nothing otherwise. So this is opt-in on the binders that
                represent money, not a preference across all of them. */}
        <div className={styles.settingControls} role="group" aria-labelledby={listId}>
          <Chip
            onPress={() => onSave(setShowValue(binder, !binder.showValue, Date.now()))}
            pressed={Boolean(binder.showValue)}
            tone={binder.showValue ? "accent" : "default"}
          >
            {binder.showValue ? "✓ Show value" : "Show value"}
          </Chip>
        </div>
      </div>

      <div className={styles.settingRow}>
        <span className={styles.settingLabel} id={tradeId}>
          Trading
        </span>
        {/* Marking a binder for trade turns on copies and condition so it
                can be PREPARED. Minting the public link is a separate act on a
                separate screen — see specs/07-shares.md — so that the first card
                you counted is not already public. */}
        <div className={styles.settingControls} role="group" aria-labelledby={tradeId}>
          <Chip
            onPress={() => onSave(setForTrade(binder, !binder.forTrade, Date.now()))}
            pressed={Boolean(binder.forTrade)}
            tone={binder.forTrade ? "accent" : "default"}
          >
            {binder.forTrade ? "✓ For trade" : "For trade"}
          </Chip>
        </div>
      </div>

      <p className={styles.note}>
        These stay with the binder and sync to your other devices. Adding and removing pages is on the
        toolbar, next to the binder itself.
      </p>
    </div>
  );
}
