import type { SyncStatus } from "../../../app/LibraryProvider.tsx";

/**
 * The one line the empty Home shows about sync, or null when there is nothing
 * to add. A pure function of the status.
 *
 * Only the states that today leave a fresh device with no explanation get a
 * line: offline, idle (server unreachable) and a refused token. Off and
 * disabled are a choice, and syncing already says so on its own action.
 */
export function emptySyncLine(status: SyncStatus): string | null {
  switch (status.state) {
    case "offline":
      return "You're offline. Your collection will appear when you're back online.";
    case "idle":
      return "Can't reach the CardLens server right now. Browse sets still works and nothing is lost.";
    case "bad-token":
      return "This device's sync token was refused. Copy it again from the server's .env file, then press Connect this device.";
    default:
      return null;
  }
}
