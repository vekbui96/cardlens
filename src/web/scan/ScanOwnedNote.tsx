import { useLibrary } from "../../app/LibraryProvider.tsx";
import type { CollectFinish } from "../../models/cards.ts";
import { ownedNote, scanOwnership } from "./scanOwned.ts";
import styles from "./ScanScreen.module.css";

/**
 * One line on a review row saying the collection already holds this card.
 *
 * Derived on render from the row's current printing, so switching the finish
 * chip from Normal to Reverse updates it at once. Nothing is stored.
 */
export function ScanOwnedNote({ cardId, finish }: { cardId: string; finish: CollectFinish }) {
  const library = useLibrary();
  const note = ownedNote(scanOwnership(cardId, finish, library));
  return note ? (
    <span className={styles.sub} data-testid="owned-note">
      {note}
    </span>
  ) : null;
}
