import {
  moveSlot,
  nextEmptyPocket,
  putAt,
  type Binder,
  type BinderAddress,
  type BinderSlot,
} from "../../../models/binderLayout.ts";
import type { DragSource } from "./useBinderDrag.ts";

/**
 * The two edits the binder screen actually makes, as pure functions.
 *
 * Pulled out of the component because they are the decisions worth testing —
 * swap versus replace, and where the selection goes afterwards — and testing
 * them through a rendered screen would mean testing them through react-query,
 * thirty set fetches and a drag gesture. The component stays a thin caller.
 *
 * Neither writes anything. Both return a new binder and the address the screen
 * should end up on, and the screen decides whether to save.
 */

export interface EditResult {
  binder: Binder;
  /**
   * Where the selection should sit afterwards, or `null` for "nowhere".
   * `undefined` means "leave it exactly as it was".
   */
  select?: BinderAddress | null | undefined;
}

/**
 * A drag landed.
 *
 * Two different writes, on purpose:
 *
 * - A card that came from a POCKET **swaps** with whatever is in the target.
 *   The card leaving the source has to go somewhere, and silently destroying it
 *   would be a loss with no undo. `moveSlot` also returns the binder unchanged
 *   when the two addresses are the same, which is the commonest way a drag ends
 *   — a press that moved a few pixels, or a change of mind — and without it the
 *   two writes cancel out and the card is destroyed by being moved nowhere.
 *
 * - A card that came from the PICKER **replaces**, because it came from the
 *   catalog and there is nothing to swap back. That is the same rule
 *   `placeSlot` documents for putting a card into an occupied sleeve.
 *
 * The selection is the other half. Dropping a card that was already in the
 * binder is REARRANGING, and must not open the picker on the target — that
 * answers a question nobody asked, once per card, while a page is being tidied.
 * A card dragged in from the picker IS filling, so it selects: the sheet it
 * opens is where copies, condition and "I own this" are set for what was just
 * placed.
 */
export function applyDrop(
  binder: Binder,
  source: DragSource,
  slot: BinderSlot,
  to: BinderAddress,
  now: number,
): EditResult {
  if (source.kind === "new") {
    return { binder: putAt(binder, to, slot, now), select: to };
  }
  return { binder: moveSlot(binder, source.at, to, now) };
}

/**
 * Put a card in the selected pocket — or clear it.
 *
 * Filling a binder is a SEQUENCE, so the selection moves on to the next empty
 * pocket. Leaving it put meant the next card replaced the one just placed, and
 * a binder that refuses to grow past a single card reads exactly like a picker
 * that will not add anything. Nothing said so.
 *
 * Clearing is an edit to one pocket, so the selection stays: moving it would
 * jump away from what was just emptied.
 *
 * The COVER is not part of that sequence. Advancing off it into page 1, pocket
 * 1 would be the app deciding you meant to carry on filling pages when you were
 * setting a cover.
 *
 * With NOTHING selected, a card goes in the first empty pocket. On a desktop
 * the rail is open whether or not a pocket is chosen, so clicking a card having
 * chosen nothing is an ordinary thing to do, and refusing it would make the
 * rail a shop window.
 */
export function applyPlace(
  binder: Binder,
  selected: BinderAddress | null,
  slot: BinderSlot | null,
  now: number,
): EditResult | null {
  const at = selected ?? (slot ? nextEmptyPocket(binder, { page: 0, index: -1 }) : null);
  if (!at) return null;
  const next = putAt(binder, at, slot, now);
  if (!slot) return { binder: next, select: at };
  return { binder: next, select: at.kind === "cover" ? at : nextEmptyPocket(next, at) };
}
