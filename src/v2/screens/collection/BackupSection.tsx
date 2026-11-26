import { useLibrary } from "../../../app/LibraryProvider.tsx";
import { useOwnedCards } from "../../../hooks/useOwnedCards.ts";
import { backupCounts, buildBackupFile, type BackupKind } from "../../../models/backupExport.ts";
import { Chip, Panel, Row, Stack } from "../../primitives/index.ts";
import styles from "./collection.module.css";

/** Saves one file. Same technique as the Download CSV chip; the BOM is already in CSV text. */
function download(file: ReturnType<typeof buildBackupFile>): void {
  const blob = new Blob([file.text], { type: file.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * "Back up" — read-only copies of the owned cards and the binders, saved to
 * the device. Nothing is written to the collection, the binders or the server.
 */
export function BackupSection() {
  const { binders } = useLibrary();
  const { rows, pending, pricing } = useOwnedCards();
  const counts = backupCounts(rows, binders);
  // A file written while sets are still pricing would list their cards as unpriced.
  const settling = pricing > 0 || pending > 0;
  const nothingOwned = counts.owned === 0;
  const nothingBinders = counts.binders === 0;

  const save = (kind: BackupKind) => download(buildBackupFile(kind, rows, binders, new Date()));

  const buttons: { kind: BackupKind; label: string; off: boolean }[] = [
    { kind: "owned-csv", label: `Owned cards (CSV) · ${counts.owned}`, off: nothingOwned || settling },
    { kind: "owned-json", label: `Owned cards (JSON) · ${counts.owned}`, off: nothingOwned || settling },
    { kind: "binders-csv", label: `Binders (CSV) · ${counts.binders}`, off: nothingBinders },
    { kind: "binders-json", label: `Binders (JSON) · ${counts.binders}`, off: nothingBinders },
  ];

  return (
    <Panel title="Back up" headingLevel={2}>
      <Stack gap={3}>
        <p className={styles.summary} data-testid="backup-note">
          Saves read-only copies of your owned cards and binders to this device. Nothing in CardLens changes.
        </p>
        <Row gap={2} wrap>
          {buttons.map((b) => (
            <Chip key={b.kind} onPress={() => save(b.kind)} disabled={b.off}>
              {b.label}
            </Chip>
          ))}
        </Row>
        {nothingOwned ? (
          <p className={styles.summary} data-testid="backup-empty-owned">
            Nothing to back up yet: no owned cards. Scan a card or use Add many cards.
          </p>
        ) : settling ? (
          <p className={styles.summary}>Still pricing your sets; the owned-card files unlock when done.</p>
        ) : null}
        {nothingBinders ? (
          <p className={styles.summary} data-testid="backup-empty-binders">
            Nothing to back up yet: no binders. Make one with New binder.
          </p>
        ) : null}
      </Stack>
    </Panel>
  );
}
