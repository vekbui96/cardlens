import type { SyncStatus } from "../../../app/LibraryProvider.tsx";
import { Card, Stack } from "../../primitives/index.ts";
import { EmptyStart } from "./EmptyStart.tsx";
import { emptySyncLine } from "./emptySyncLine.ts";
import styles from "./Home.module.css";

/**
 * Nothing tracked yet. The wording and the two ways in are `EmptyStart`'s,
 * shared with Everything owned and the set list (#165); this adds Home's sync
 * line and Connect this device.
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
   * arrive Home swaps to the full screen. Offline / idle / refused token get
   * no action but a status line below the hint (`emptySyncLine`).
   */
  const connect =
    syncStatus.state === "off" || syncStatus.state === "bad-token"
      ? "offer"
      : syncStatus.state === "syncing"
        ? "busy"
        : null;
  const syncLine = emptySyncLine(syncStatus);
  return (
    <div className={styles.emptyWrap} data-testid="first-run-card">
      <EmptyStart
        headingLevel={1}
        status={syncLine}
        extraActions={
          <>
            {connect === "offer" ? (
              <Card onPress={onConnect} className={styles.tile} pad={4}>
                <Stack gap={1}>
                  <span className={styles.actionName}>Connect this device</span>
                  <span className={styles.actionHint}>
                    Already use CardLens elsewhere? You will need the sync token from the server's .env file.
                  </span>
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
          </>
        }
      />
    </div>
  );
}
