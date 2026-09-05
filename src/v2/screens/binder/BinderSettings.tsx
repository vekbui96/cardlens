import { useId, useState } from "react";
import { Chip, Panel, Row, Stack, cx } from "../../primitives/index.ts";
import {
  BINDER_FORMATS,
  reformat,
  setForTrade,
  setShowValue,
  specFor,
  type Binder,
} from "../../../models/binderLayout.ts";
import styles from "./binder.module.css";

/**
 * Everything about the binder ITSELF, behind one disclosure.
 *
 * The toolbar used to carry two different kinds of thing side by side: actions
 * you take over and over while laying a binder out (add a page, remove one) and
 * settings you set once and forget (how many pockets, whether it is priced on
 * the list, whether it is offered for trade). Six controls of equal weight, and
 * the ones pressed constantly were the hardest to find among them.
 *
 * Collapsed by default, and NOT a modal: changing the format re-flows every
 * page and marking a binder for trade changes what each pocket shows, so the
 * binder has to stay visible underneath while you do it. A dialog would cover
 * the thing being configured.
 */
export function BinderSettings({
  binder,
  onSave,
  headingLevel = 2,
}: {
  binder: Binder;
  onSave: (binder: Binder) => void;
  headingLevel?: 2 | 3;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <Stack gap={2}>
      <Row gap={2} wrap>
        <button
          type="button"
          className={cx(styles.button, open && styles.buttonOn)}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
        >
          Settings
        </button>
        {/* What is switched on, readable without opening the panel. Both change
            what the binder DOES, and a binder quietly still on offer is exactly
            the thing you want to notice from the outside. Gold AND a word —
            state this app cares about is never carried by colour alone. */}
        {binder.forTrade ? <Chip tone="gold">For trade</Chip> : null}
        {binder.showValue ? <Chip tone="gold">Priced in list</Chip> : null}
      </Row>

      {open ? (
        <div id={panelId}>
          <Panel title="Binder settings" headingLevel={headingLevel} tone="raised">
            <Stack gap={4}>
              <SettingRow label="Pocket size">
                {/* Re-flows the pages in reading order — positions cannot
                    survive, because a 2-wide page has no pocket matching the
                    9th of a 3-wide one. The COVER is untouched: it is not a
                    pocket and not contents. */}
                {BINDER_FORMATS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={cx(styles.button, binder.format === f && styles.buttonOn)}
                    aria-pressed={binder.format === f}
                    onClick={() => onSave(reformat(binder, f, Date.now()))}
                  >
                    {specFor(f).label}
                  </button>
                ))}
              </SettingRow>

              <SettingRow label="In the list">
                {/* Off by default. Pricing a binder is a request per set it
                    spans — the Riolu binder touches thirty — and the binders
                    list asks for nothing otherwise. So this is opt-in on the
                    binders that represent money, not on all of them. */}
                <button
                  type="button"
                  className={cx(styles.button, binder.showValue && styles.buttonOn)}
                  aria-pressed={Boolean(binder.showValue)}
                  onClick={() => onSave(setShowValue(binder, !binder.showValue, Date.now()))}
                >
                  {binder.showValue ? "✓ Show value" : "Show value"}
                </button>
              </SettingRow>

              <SettingRow label="Trading">
                {/* Marking a binder for trade turns on copies and condition so
                    it can be PREPARED, which is most of the work and happens
                    before anyone is shown anything. Minting the link is a
                    separate act, on the binders list — rolling them together
                    would make the first card you counted already public. */}
                <button
                  type="button"
                  className={cx(styles.button, binder.forTrade && styles.buttonOn)}
                  aria-pressed={Boolean(binder.forTrade)}
                  onClick={() => onSave(setForTrade(binder, !binder.forTrade, Date.now()))}
                >
                  {binder.forTrade ? "✓ For trade" : "For trade"}
                </button>
              </SettingRow>

              <p className={styles.hint}>
                These stay with the binder and sync to your other devices. Adding and removing pages is up on
                the toolbar, next to the binder itself.
              </p>
            </Stack>
          </Panel>
        </div>
      ) : null}
    </Stack>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <Row gap={2} wrap>
      <span className={styles.hint} id={id}>
        {label}
      </span>
      {/* A real group, so a screen reader reads "Pocket size" before the three
          buttons rather than reading three unrelated toggles. `Row` cannot
          carry a role, so this one is a plain element on a class of its own. */}
      <div className={styles.settingControls} role="group" aria-labelledby={id}>
        {children}
      </div>
    </Row>
  );
}
