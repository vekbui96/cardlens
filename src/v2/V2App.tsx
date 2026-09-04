import { useEffect } from "react";
import "./tokens.css";
import "./shell/reset.css";
import { V2Shell } from "./shell/V2Shell.tsx";
import { V2Router } from "./V2Router.tsx";

/**
 * The v2 entry point, and the only module `App.tsx` knows about.
 *
 * Everything v2 hangs off this one import, and this one import is lazy — so a
 * v1 user never downloads a byte of the rebuild. That is asserted against the
 * built output in `e2e/v2/bundle.spec.ts`, not trusted: the whole arrangement
 * is worthless if a stray eager import from a shared module drags v2 back into
 * the entry chunk, and that is not visible by reading.
 *
 * It deliberately mounts NO providers. React Query, Repositories, Library and
 * Navigation are all above it in `App.tsx`, shared with v1. A second
 * QueryClient here would mean two caches, two sets of requests, and a sync
 * racing itself — which is the failure the shared-provider rule exists to
 * prevent.
 */
export function V2App() {
  useUiAttribute();
  return (
    <V2Shell version="v2">
      <V2Router />
    </V2Shell>
  );
}

/**
 * Mark the document as v2.
 *
 * It goes on `<html>` rather than on the shell's own div because the things it
 * has to reach — `body`'s centring, `#root`'s flexbox — are ancestors of
 * anything React renders. `styles/global.css` sets those for the glasses, where
 * centring a 600x600 square in the window is exactly right; inheriting it here
 * would vertically centre the entire page.
 *
 * Removed on unmount so nothing is left behind if v2 is ever mounted and
 * discarded within one page — the workshop and the tests both do that.
 */
function useUiAttribute(): void {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute("data-ui");
    root.setAttribute("data-ui", "v2");
    return () => {
      if (previous === null) root.removeAttribute("data-ui");
      else root.setAttribute("data-ui", previous);
    };
  }, []);
}
