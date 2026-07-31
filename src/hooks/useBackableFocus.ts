import { useEffect, useRef } from "react";
import { useFocusList } from "./useFocusList.ts";

export interface BackableFocusOptions {
  /** Number of content items (excluding Back). */
  count: number;
  onSelect: (index: number) => void;
  onSelectHold?: (index: number) => void;
  onBack: () => void;
  onLeft?: (index: number) => void;
  onRight?: (index: number) => void;
  enabled?: boolean;
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
  const { count, onSelect, onSelectHold, onBack, onLeft, onRight, enabled = true } = options;

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
    ...(onSelectHold ? { onSelectHold: (i: number) => (i === 0 ? undefined : onSelectHold(i - 1)) } : {}),
  });

  // When content first appears (e.g. results finish loading), move focus off Back
  // onto the first item so users don't have to swipe down.
  const prevCount = useRef(count);
  useEffect(() => {
    if (prevCount.current === 0 && count > 0 && focusIndex === 0) setFocusIndex(1);
    prevCount.current = count;
  }, [count, focusIndex, setFocusIndex]);

  return { backFocused: focusIndex === 0, itemIndex: focusIndex - 1 };
}
