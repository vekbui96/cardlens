import { useEffect, useRef } from "react";
import type { WearableInputEvent } from "../models/input.ts";
import { useInputAdapter } from "../app/contexts.tsx";

/**
 * Subscribe to normalized wearable input events. The handler is kept in a ref so
 * callers don't need to memoize it. `enabled=false` suspends the subscription
 * (used so only the active screen reacts, and modals can capture input).
 */
export function useWearableInput(handler: (event: WearableInputEvent) => void, enabled = true): void {
  const adapter = useInputAdapter();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    return adapter.subscribe((event) => handlerRef.current(event));
  }, [adapter, enabled]);
}
