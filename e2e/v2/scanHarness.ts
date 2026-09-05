import { createElement } from "react";
import { useNavigation } from "../../src/app/NavigationProvider.tsx";
import { ScanScreen } from "../../src/v2/screens/scan/index.ts";

/**
 * A stand-in for `src/v2/V2Router.tsx`, used by `scan.spec.ts` only.
 *
 * Streams are forbidden from editing the real router — the integrator wires
 * each screen in, and nine streams each editing one switch statement in
 * parallel is nine merge conflicts. But a screen the router does not know about
 * cannot be reached by a browser at all, so an e2e suite would have nothing to
 * drive.
 *
 * So the spec intercepts the module request for `V2Router.tsx` and serves a
 * one-line re-export of this file instead. Everything else is real: the same
 * `index.html`, the same providers, the same shell, the same navigation, the
 * same dev server. The ONLY thing faked is the single line the integrator is
 * going to write, which is exactly the line this stream is not allowed to
 * touch. Delete this file once `scan` has its case in the real router.
 */
export function V2Router() {
  const { screen } = useNavigation();
  if (screen.name === "scan") return createElement(ScanScreen);
  return createElement("p", null, `No harness for ${screen.name}.`);
}

/** The real router exports this too, and `V2App` imports the module wholesale. */
export function ScreenSkeleton() {
  return null;
}
