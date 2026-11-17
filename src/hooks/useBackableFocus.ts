import { useEffect, useRef } from "react";
import { useFocusList } from "./useFocusList.ts";

export interface BackableFocusOptions {
  /** Number of content items (excluding Back). */
  count: number;
  onSelect: (index: number) => void;
  onBack: () => void;
  onLeft?: (index: number) => void;
  onRight?: (index: number) => void;
  enabled?: boolean;
  /**
   * When this value changes, the list has been replaced (a rarity swipe), so
   * focus jumps to content item `resetTo`. Without it focus keeps its row
   * NUMBER: a cached or locally filtered list swaps without passing through
   * zero, so only the clamp runs and a short filter opens on its last card.
   */
  resetFocusOn?: unknown;
  /** Content index a `resetFocusOn` change lands on (default 0, the first item). */
  resetTo?: number;
}

export interface BackableFocusState {
  /** True when the Back control is focused. */
  backFocused: boolean;
  /** Focused content index (0-based), or -1 when Back is focused. */
  itemIndex: number;
}

/**
 * Focus ring with a reliable, always-present "Back" slot at the top (index 0),
 * activated by the normal index-finger pinch (SELECT). This does not depend on
 * the middle-finger pinch, which the glasses OS partly reserves and which Meta
 * lists as unsupported for Web Apps. Middle-pinch (Escape/BACK) still triggers
 * back as a bonus when it reaches the app. Focus starts on the first content
 * item (not Back), and advances off Back to the first item when content first
 * loads.
 */
export function useBackableFocus(options: BackableFocusOptions): BackableFocusState {
  const { count, onSelect, onBack, onLeft, onRight, enabled = true, resetFocusOn, resetTo = 0 } = options;

  const { focusIndex, setFocusIndex } = useFocusList({
    count: count + 1, // slot 0 = Back
    enabled,
    initialIndex: count > 0 ? 1 : 0,
    onBack,
    ...(onLeft ? { onLeft: (i) => onLeft(i - 1) } : {}),
    ...(onRight ? { onRight: (i) => onRight(i - 1) } : {}),
    onSelect: (i) => (i === 0 ? onBack() : onSelect(i - 1)),
    // Holding on Back does nothing: destructive-ish bulk actions should never
    // sit under the control people use to leave.
  });

  // When content first appears (e.g. results finish loading), move focus off Back
  // onto the first item so users don't have to swipe down.
  const prevCount = useRef(count);
  useEffect(() => {
    if (prevCount.current === 0 && count > 0 && focusIndex === 0) setFocusIndex(1);
    prevCount.current = count;
  }, [count, focusIndex, setFocusIndex]);

  // A replaced list starts at its top. If the target row does not exist yet
  // (the new list is still loading, or is empty), remember the slot focus was
  // parked on and finish the move when the rows arrive — unless the user has
  // moved focus in the meantime, which always wins.
  const lastResetKey = useRef(resetFocusOn);
  const parkedAt = useRef<number | null>(null);
  useEffect(() => {
    const target = resetTo + 1; // slot 0 = Back
    if (!Object.is(lastResetKey.current, resetFocusOn)) {
      lastResetKey.current = resetFocusOn;
      const slot = Math.max(0, Math.min(target, count));
      setFocusIndex(slot);
      parkedAt.current = slot < target ? slot : null;
      return;
    }
    if (parkedAt.current === null) return;
    if (focusIndex !== parkedAt.current) parkedAt.current = null;
    else if (count >= target) {
      setFocusIndex(target);
      parkedAt.current = null;
    }
  }, [resetFocusOn, resetTo, count, focusIndex, setFocusIndex]);

  return { backFocused: focusIndex === 0, itemIndex: focusIndex - 1 };
}
