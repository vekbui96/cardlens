import type { SyncStatus } from "../../app/LibraryProvider.tsx";

/**
 * Turn sync state into one row's worth of text.
 *
 * Pure and separate from the screen so the wording is testable — this is the
 * only place sync failure is ever communicated, since a failed sync is not an
 * error the user must act on and does not get a toast.
 */
export function syncLine(status: SyncStatus): { label: string; hint: string; on: boolean } {
  const pending = status.pending;
  const pendingText = pending === 1 ? "1 change waiting" : `${pending} changes waiting`;

  switch (status.state) {
    case "off":
      return { label: "Sync: off", hint: "Select to connect", on: false };
    case "syncing":
      return { label: "Sync: syncing…", hint: pending ? pendingText : "", on: true };
    case "bad-token":
      return { label: "Sync: token rejected", hint: "Select to re-enter", on: false };
    case "disabled":
      return { label: "Sync: off on server", hint: "COLLECTION_TOKEN not set", on: false };
    case "offline":
      return {
        label: "Sync: offline",
        hint: pending ? pendingText : "Will retry",
        on: false,
      };
    case "idle":
    default:
      return {
        label: pending ? "Sync: pending" : "Sync: on",
        hint: pending ? pendingText : `${lastSyncedText(status.lastSyncAt)} · ← to disconnect`,
        on: true,
      };
  }
}

function lastSyncedText(at: number): string {
  if (!at) return "Select to sync";
  const mins = Math.floor((Date.now() - at) / 60_000);
  if (mins < 1) return "Synced just now";
  if (mins < 60) return `Synced ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Synced ${hours}h ago`;
  return `Synced ${Math.floor(hours / 24)}d ago`;
}
