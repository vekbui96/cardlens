import { lazy, Suspense } from "react";
import { useNavigation } from "../app/NavigationProvider.tsx";
import type { Screen } from "../app/navigation.ts";
import { V2ErrorBoundary } from "./shell/V2ErrorBoundary.tsx";
import { Panel, ScreenReaderOnly, Stack } from "./primitives/index.ts";
import styles from "./shell/V2Shell.module.css";

/**
 * Which v2 screen to render.
 *
 * Phase 0 ships this router with every screen unbuilt on purpose. Each stream
 * from `docs/v2/PLAN.md` §5 replaces exactly one entry in `SCREENS` with its
 * own lazy import, and touches nothing else in this file — which is what lets
 * nine of them land in any order without conflicting.
 */

const Workshop = lazy(() => import("./dev/Workshop.tsx").then((m) => ({ default: m.Workshop })));

/**
 * The spec that owns each screen, and therefore who to go and ask. Shown on
 * the placeholder, so an unbuilt screen answers "when?" instead of just
 * looking broken.
 */
const OWNER: Partial<Record<Screen["name"], { spec: string; title: string }>> = {
  home: { spec: "01-home", title: "Home" },
  collection: { spec: "02-collection", title: "Collection & sets" },
  sets: { spec: "02-collection", title: "Collection & sets" },
  owned: { spec: "02-collection", title: "Everything owned" },
  set: { spec: "03-set-cards", title: "Set cards" },
  binders: { spec: "04-binders", title: "Binders" },
  binder: { spec: "05-binder", title: "Binder builder" },
  scan: { spec: "06-scan", title: "Scan" },
  showcase: { spec: "07-shares", title: "Showcase" },
  live: { spec: "07-shares", title: "Live share" },
  trade: { spec: "07-shares", title: "Trade share" },
  target: { spec: "08-target-sealed", title: "Target" },
  sealed: { spec: "08-target-sealed", title: "Sealed" },
  results: { spec: "09-search-details", title: "Search" },
  details: { spec: "09-search-details", title: "Card details" },
};

export function V2Router() {
  const { screen } = useNavigation();

  return (
    <V2ErrorBoundary resetKey={screen.name}>
      <Suspense fallback={<ScreenSkeleton />}>{render(screen)}</Suspense>
    </V2ErrorBoundary>
  );
}

function render(screen: Screen) {
  switch (screen.name) {
    case "workshop":
      return <Workshop />;
    default:
      return <NotBuilt screen={screen} />;
  }
}

/**
 * A screen that has not been built yet.
 *
 * It says which spec owns it and stays inside the shell, so the header, the
 * navigation and the version switch all still work. During a rebuild the
 * honest empty state is worth more than a blank page: it is the difference
 * between "this is next" and "this is broken".
 */
function NotBuilt({ screen }: { screen: Screen }) {
  const owner = OWNER[screen.name];
  return (
    <Stack gap={4}>
      <Panel title={owner?.title ?? screen.name} tone="raised">
        <Stack gap={3}>
          <p>
            Not built yet. This screen belongs to <code>docs/v2/specs/{owner?.spec ?? "—"}.md</code>, and
            Phase 1 has not reached it.
          </p>
          <p>
            The old interface has it today — switch to V1 in the header. Both versions read the same
            collection, so nothing here is lost.
          </p>
        </Stack>
      </Panel>
    </Stack>
  );
}

/**
 * The shell stays; only the content area shows the wait. A spinner on an empty
 * page makes every screen change look like a full page load, when what is
 * actually happening is one lazy chunk arriving.
 */
export function ScreenSkeleton() {
  return (
    <div className={styles.skeleton} aria-busy="true" aria-live="polite">
      <ScreenReaderOnly>Loading</ScreenReaderOnly>
      <div className={`${styles.skeletonBar} ${styles.skeletonBarWide}`} />
      <div className={styles.skeletonBar} />
      <div className={styles.skeletonBar} />
    </div>
  );
}
