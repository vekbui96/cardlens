import { useCallback, useEffect, useRef, useState } from "react";
import type { WearableInputEvent } from "../models/input.ts";
import { useWearableInput } from "./useWearableInput.ts";

export interface FocusListOptions {
  count: number;
  onSelect: (index: number) => void;
  onBack?: () => void;
  onLeft?: (index: number) => void;
  onRight?: (index: number) => void;
  /** Wrap around top/bottom (default false — clamp). */
  wrap?: boolean;
  enabled?: boolean;
  initialIndex?: number;
}

export interface FocusListState {
  focusIndex: number;
  setFocusIndex: (index: number) => void;
}

/**
 * Vertical D-pad focus ring driven by wearable input:
 *   SWIPE_UP/DOWN move focus, SELECT activates, BACK cancels, LEFT/RIGHT optional.
 * Clamps focus when the item count changes so it never points off the list.
 */
export function useFocusList(options: FocusListOptions): FocusListState {
  const {
    count,
    onSelect,
    onBack,
    onLeft,
    onRight,
    wrap = false,
    enabled = true,
    initialIndex = 0,
  } = options;
  const [focusIndex, setFocusIndex] = useState(initialIndex);

  // Keep focus in range as the list grows/shrinks.
  useEffect(() => {
    setFocusIndex((i) => {
      if (count <= 0) return 0;
      return Math.min(i, count - 1);
    });
  }, [count]);

  const move = useCallback(
    (delta: number) => {
      setFocusIndex((i) => {
        if (count <= 0) return 0;
        const next = i + delta;
        if (wrap) return (next + count) % count;
        return Math.max(0, Math.min(count - 1, next));
      });
    },
    [count, wrap],
  );

  const focusRef = useRef(focusIndex);
  focusRef.current = focusIndex;

  const handle = useCallback(
    (event: WearableInputEvent) => {
      switch (event.type) {
        case "SWIPE_UP":
          move(-1);
          break;
        case "SWIPE_DOWN":
          move(1);
          break;
        case "SWIPE_LEFT":
          onLeft?.(focusRef.current);
          break;
        case "SWIPE_RIGHT":
          onRight?.(focusRef.current);
          break;
        case "SELECT":
          if (count > 0) onSelect(focusRef.current);
          break;
        case "BACK":
          onBack?.();
          break;
      }
    },
    [move, onSelect, onBack, onLeft, onRight, count],
  );

  useWearableInput(handle, enabled);

  return { focusIndex, setFocusIndex };
}
