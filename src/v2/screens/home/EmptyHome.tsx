import type { SyncStatus } from "../../../app/LibraryProvider.tsx";
import { Card, Panel, Stack } from "../../primitives/index.ts";
import { screenToPath } from "../../../app/screenUrl.ts";
import styles from "./Home.module.css";

/**
 * Nothing tracked yet.
 *
 * The one state where Home stops reporting and starts offering, because an
 * empty dashboard is a dead end: there is no number to read, no set to resume,
 * and every panel on the full screen would render as a row of dashes.
 *
 * Both actions are real `<a href>`s to real routes, not buttons that open
 * something. That matters more here than anywhere else on the screen — if
 * either of the only two ways out of an empty collection is a dead end, the
 * app has no first-run path at all.
 */
export function EmptyHome({ syncStatus, onConnect }: { syncStatus: SyncStatus; onConnect: () => void }) {
  /*
   * A third way in, for a fresh device whose collection already lives on the
   * server. Offered only where it can work: sync off, or a rejected token.
   * While the first pull runs it says so (and is not pressable); once rows
   * arrive Home swaps to the full screen. Offline / idle / server-off show
   * nothing here — the shell's sync label and Home's notice cover those.
   */
  const connect =
    syncStatus.state === "off" || syncStatus.state === "bad-token"
      ? "offer"
      : syncStatus.state === "syncing"
        ? "busy"
        : null;
  return (
    <Panel tone="raised" pad={5}>
      <Stack gap={4}>
        <h1 className={styles.emptyTitle}>Nothing tracked yet</h1>
        <p className={styles.emptyHint}>
          Open a set and mark the printings you own, or search for a card you have. Everything is saved on
          this device straight away — sync is optional and comes later.
        </p>
        <div className={styles.actions}>
          <Card href={`#${screenToPath({ name: "sets" })}`} className={styles.tile} pad={4}>
            <Stack gap={1}>
              <span className={styles.actionName}>Browse sets</span>
              <span className={styles.actionHint}>Pick a set and tick off what you have</span>
            </Stack>
          </Card>
          <Card href={`#${screenToPath({ name: "results", query: "" })}`} className={styles.tile} pad={4}>
            <Stack gap={1}>
              <span className={styles.actionName}>Search for a card</span>
              <span className={styles.actionHint}>By name or collector number</span>
            </Stack>
          </Card>
          {connect === "offer" ? (
            <Card onPress={onConnect} className={styles.tile} pad={4}>
              <Stack gap={1}>
                <span className={styles.actionName}>Connect this device</span>
                <span className={styles.actionHint}>Already use CardLens on another device?</span>
              </Stack>
            </Card>
          ) : null}
          {connect === "busy" ? (
            <Card className={styles.tile} pad={4}>
              <Stack gap={1}>
                <span className={styles.actionName}>Connecting…</span>
                <span className={styles.actionHint}>Pulling the collection from your other device</span>
              </Stack>
            </Card>
          ) : null}
        </div>
      </Stack>
    </Panel>
  );
}
