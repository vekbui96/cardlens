import { useCallback, useEffect, useState } from "react";
import { loadCardIndex, resetCardIndex, type CardIndex } from "../../../scan/cardIndex.ts";

/**
 * The on-device artwork index.
 *
 * Fetched on mount rather than on first capture: it is 13KB, the permission
 * prompt is far slower, so fetching it now is free and fetching it later is a
 * stall in the middle of a scan.
 *
 * It is also what makes the scanner work when the house does not — SERVER-PC
 * has been found powered off twice — so "it failed to load" is a state the
 * screen has to say out loud rather than degrade into.
 */

export type IndexState =
  { status: "loading" } | { status: "ready"; index: CardIndex } | { status: "failed"; error: string };

export function useCardIndex(): { state: IndexState; retry: () => void } {
  const [state, setState] = useState<IndexState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    loadCardIndex().then(
      (index) => live && setState({ status: "ready", index }),
      (err: Error) => live && setState({ status: "failed", error: err.message }),
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    // The module caches the PROMISE, so a failed load stays failed for the
    // session unless the cache is cleared first. Without this, "Try again"
    // would hand back the same rejection instantly and look like a dead button.
    resetCardIndex();
    setAttempt((n) => n + 1);
  }, []);

  return { state, retry };
}
