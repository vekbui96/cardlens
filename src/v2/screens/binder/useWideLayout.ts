import { useEffect, useState } from "react";

/**
 * Whether there is room for the picker to stand BESIDE the binder.
 *
 * A media query in JavaScript rather than in CSS, because the two layouts are
 * not the same markup styled differently: on a phone the picker is a modal
 * `Sheet` that traps focus, and on a desktop it is a `RailHost` rail that does
 * not. Rendering both and hiding one would mount two pickers — two `useSetView`
 * calls, so two requests for the same set — and would put a focus trap in the
 * document at every width.
 *
 * 1000px is the number the geometry actually needs, not a device: two 12-pocket
 * pages plus the gutter want more than a phone has, and below that the pages
 * stack one at a time.
 */
const WIDE = "(min-width: 1000px)";

export function useWideLayout(): boolean {
  const [wide, setWide] = useState(() => matches());

  useEffect(() => {
    // jsdom has no real matchMedia; the test setup stubs one that never
    // changes, so this stays inert under test rather than throwing.
    const query = window.matchMedia?.(WIDE);
    if (!query) return;
    const onChange = () => setWide(query.matches);
    onChange();
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);

  return wide;
}

function matches(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.(WIDE).matches ?? false;
}
