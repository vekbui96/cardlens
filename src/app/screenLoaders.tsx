import { lazy, useState, type ComponentProps, type ComponentType } from "react";
import type { CardDetailsScreen as CardDetailsScreenComponent } from "../features/card-details/CardDetailsScreen.tsx";
import { useLayoutMode } from "./contexts.tsx";
import type { LayoutMode } from "./layoutMode.ts";
import type { Screen } from "./navigation.ts";
import { recoverFromChunkError } from "./staleChunk.ts";

/**
 * Every lazy screen, and the way to fetch one before it is tapped.
 *
 * Screens are code-split so the first load stays small, and the cost of that
 * is a round trip on every FIRST visit: measured on the live site, 0.14-0.27s
 * per screen chunk from a wired line, with the "Loading…" fallback on screen
 * for all of it. On the web the next tap is predictable — the app bar names
 * every destination — so the chunks are fetched while the page is idle, and
 * again the moment a finger lands on a link (`touchstart` leads the click by
 * roughly the size of that round trip).
 *
 * The glasses never prefetch. They download only their own screens, which is
 * the promise ScreenRouter's comments make and `e2e/shell-isolation.spec.ts`
 * now asserts.
 */

type Props = object;

export interface PreloadableScreen<P extends Props> {
  /** What ScreenRouter renders. */
  Component: ComponentType<P>;
  /** Fetch the chunk now. Resolves once it is loaded; rejects if it cannot be. */
  prefetch: () => Promise<void>;
}

/**
 * `lazy()`, plus a prefetch that shares its loader.
 *
 * Sharing one memoised promise is what makes a prefetch count: a second
 * `import()` would warm the browser's module cache but leave `lazy` with a
 * promise of its own to await.
 *
 * And it is not enough on its own. `lazy` SUSPENDS on its first render even
 * when the promise it is handed has already resolved — it cannot see that
 * until a microtask later — so the fallback still flashes. A screen mounted
 * after its chunk has landed therefore renders the module directly. That
 * choice is made once per mount: switching from the lazy wrapper to the bare
 * component mid-life would remount the screen and lose its state.
 *
 * A failed fetch is forgotten, so the next prefetch or the real tap tries
 * again — exactly what an offline blip should cost.
 *
 * The render path — never the prefetch — also recovers from a chunk that a
 * deploy deleted, with one guarded reload (see `staleChunk.ts`). A prefetch
 * that failed for that reason stays silent until the tap renders the screen.
 */
export function preloadableScreen<P extends Props>(
  load: () => Promise<ComponentType<P>>,
): PreloadableScreen<P> {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;

  const fetchOnce = (): Promise<ComponentType<P>> => {
    pending ??= load().then(
      (component) => {
        loaded = component;
        return component;
      },
      (error: unknown) => {
        pending = null;
        throw error;
      },
    );
    return pending;
  };

  // Typed as the component it stands in for. `LazyExoticComponent<ComponentType<P>>`
  // folds ref attributes into its props, which TypeScript cannot reconcile with
  // an unconstrained generic P — though at runtime it forwards props verbatim.
  const Lazy = lazy(() =>
    fetchOnce().then((component) => ({ default: component }), recoverFromChunkError),
  ) as unknown as ComponentType<P>;

  function PreloadableScreenComponent(props: P) {
    const [Ready] = useState(() => loaded);
    return Ready ? <Ready {...props} /> : <Lazy {...props} />;
  }

  return { Component: PreloadableScreenComponent, prefetch: () => fetchOnce().then(() => undefined) };
}

export const ResultsScreen = preloadableScreen(() =>
  import("../features/results/ResultsScreen.tsx").then((m) => m.ResultsScreen),
);
// Annotated because its props interface is not exported, and an exported const
// must have a type the declaration emit can name. The import is type-only, so
// it adds nothing to any chunk.
export const CardDetailsScreen: PreloadableScreen<ComponentProps<typeof CardDetailsScreenComponent>> =
  preloadableScreen(() =>
    import("../features/card-details/CardDetailsScreen.tsx").then((m) => m.CardDetailsScreen),
  );
export const FavoritesScreen = preloadableScreen(() =>
  import("../features/favorites/FavoritesScreen.tsx").then((m) => m.FavoritesScreen),
);
export const RecentScreen = preloadableScreen(() =>
  import("../features/recent/RecentScreen.tsx").then((m) => m.RecentScreen),
);
export const PopularScreen = preloadableScreen(() =>
  import("../features/popular/PopularScreen.tsx").then((m) => m.PopularScreen),
);
export const SetsScreen = preloadableScreen(() =>
  import("../features/sets/SetsScreen.tsx").then((m) => m.SetsScreen),
);
export const SetCardsScreen = preloadableScreen(() =>
  import("../features/sets/SetCardsScreen.tsx").then((m) => m.SetCardsScreen),
);
export const WebSetCardsScreen = preloadableScreen(() =>
  import("../web/sets/WebSetCardsScreen.tsx").then((m) => m.WebSetCardsScreen),
);
export const WebSetsScreen = preloadableScreen(() =>
  import("../web/sets/WebSetsScreen.tsx").then((m) => m.WebSetsScreen),
);
export const WebHomeScreen = preloadableScreen(() =>
  import("../web/home/WebHomeScreen.tsx").then((m) => m.WebHomeScreen),
);
export const WebOwnedCardsScreen = preloadableScreen(() =>
  import("../web/collection/WebOwnedCardsScreen.tsx").then((m) => m.WebOwnedCardsScreen),
);
export const WebSealedScreen = preloadableScreen(() =>
  import("../web/collection/WebSealedScreen.tsx").then((m) => m.WebSealedScreen),
);
export const ScanScreen = preloadableScreen(() =>
  import("../web/scan/ScanScreen.tsx").then((m) => m.ScanScreen),
);
export const WebTargetScreen = preloadableScreen(() =>
  import("../web/target/WebTargetScreen.tsx").then((m) => m.WebTargetScreen),
);
export const WebBindersScreen = preloadableScreen(() =>
  import("../web/binders/WebBindersScreen.tsx").then((m) => m.WebBindersScreen),
);
export const WebBinderScreen = preloadableScreen(() =>
  import("../web/binders/WebBinderScreen.tsx").then((m) => m.WebBinderScreen),
);
export const LiveShowcaseScreen = preloadableScreen(() =>
  import("../web/showcase/LiveShowcaseScreen.tsx").then((m) => m.LiveShowcaseScreen),
);
export const TradeShareScreen = preloadableScreen(() =>
  import("../web/trade/TradeShareScreen.tsx").then((m) => m.TradeShareScreen),
);
export const ShowcaseScreen = preloadableScreen(() =>
  import("../web/showcase/ShowcaseScreen.tsx").then((m) => m.ShowcaseScreen),
);
export const CollectionScreen = preloadableScreen(() =>
  import("../features/collection/CollectionScreen.tsx").then((m) => m.CollectionScreen),
);

export type ScreenName = Screen["name"];
export type PrefetchTargets = Partial<Record<ScreenName, { prefetch: () => Promise<void> }>>;

/**
 * What each screen name renders ON THE WEB — the same choice ScreenRouter's
 * switch makes, for the screens a tap can reach. Links someone was sent
 * (showcase, live, trade) are absent: they are entered, never tapped into.
 */
export const WEB_PREFETCH_TARGETS: PrefetchTargets = {
  home: WebHomeScreen,
  results: ResultsScreen,
  details: CardDetailsScreen,
  favorites: FavoritesScreen,
  recent: RecentScreen,
  popular: PopularScreen,
  sets: WebSetsScreen,
  collection: WebSetsScreen,
  set: WebSetCardsScreen,
  owned: WebOwnedCardsScreen,
  sealed: WebSealedScreen,
  scan: ScanScreen,
  target: WebTargetScreen,
  binders: WebBindersScreen,
  binder: WebBinderScreen,
};

interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
}

/** Save-Data or a 2G link: the user is paying for bytes, so fetch only what is tapped. */
function onMeteredConnection(): boolean {
  if (typeof navigator === "undefined") return false;
  const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  if (!connection) return false;
  return connection.saveData === true || /(^|-)2g$/.test(connection.effectiveType ?? "");
}

/**
 * Fetch a screen's chunk ahead of the tap. Web only.
 *
 * Resolves `true` once the chunk is loaded and `false` when nothing was
 * fetched or the fetch failed. It never rejects: a prefetch is a guess, and a
 * wrong or failed guess must cost nothing visible. The real tap's `lazy()`
 * fetches again and reports its own failure as it always has.
 */
export async function prefetchScreen(
  name: ScreenName,
  mode: LayoutMode,
  targets: PrefetchTargets = WEB_PREFETCH_TARGETS,
): Promise<boolean> {
  if (mode !== "web") return false;
  if (onMeteredConnection()) return false;
  const target = targets[name];
  if (!target) return false;
  try {
    await target.prefetch();
    return true;
  } catch {
    return false;
  }
}

/** `requestIdleCallback` where it exists. Safari lacks it, so a plain delay there. */
function whenIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(run, { timeout: 5000 });
    return () => window.cancelIdleCallback(handle);
  }
  const timer = window.setTimeout(run, 2000);
  return () => window.clearTimeout(timer);
}

/**
 * Warm a list of screens once the page is idle: in order, one at a time, and
 * stopping at the first failure — a failure usually means the network went
 * away, and hammering it with the rest of the list helps nobody.
 *
 * Returns a cancel function for an effect's cleanup.
 */
export function warmScreensWhenIdle(
  names: readonly ScreenName[],
  mode: LayoutMode,
  targets: PrefetchTargets = WEB_PREFETCH_TARGETS,
): () => void {
  if (mode !== "web") return () => {};
  let cancelled = false;
  const cancelIdle = whenIdle(() => {
    void (async () => {
      for (const name of names) {
        if (cancelled) return;
        if (!(await prefetchScreen(name, mode, targets))) return;
      }
    })();
  });
  return () => {
    cancelled = true;
    cancelIdle();
  };
}

/**
 * Props that warm a screen's chunk when a pointer, finger or keyboard focus
 * arrives on the control that opens it. Spread onto the button.
 *
 * `data-prefetch-screen` names the target, which makes the wiring visible in
 * the DOM — and to e2e — without reading React props.
 */
export function usePrefetchProps(): (name: ScreenName) => {
  "data-prefetch-screen": ScreenName;
  onPointerEnter: () => void;
  onTouchStart: () => void;
  onFocus: () => void;
} {
  const mode = useLayoutMode();
  return (name) => {
    const warm = () => void prefetchScreen(name, mode);
    return { "data-prefetch-screen": name, onPointerEnter: warm, onTouchStart: warm, onFocus: warm };
  };
}
