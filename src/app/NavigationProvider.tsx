import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import type { PokemonCardSummary } from "../models/cards.ts";
import { canGoBack, currentScreen, initialNavState, navReducer, type Screen } from "./navigation.ts";
import { screenFromLocation, screenToPath } from "./screenUrl.ts";

interface NavigationValue {
  screen: Screen;
  canGoBack: boolean;
  push: (screen: Screen) => void;
  replace: (screen: Screen) => void;
  pop: () => void;
  home: () => void;
  // Convenience navigators used across screens.
  openResults: (query: string) => void;
  openDetails: (cardId: string, summary?: PokemonCardSummary) => void;
  openSets: () => void;
  openSet: (setId: string, setName: string) => void;
}

const NavigationContext = createContext<NavigationValue | null>(null);

function currentHash(): string {
  return typeof window === "undefined" ? "" : window.location.hash;
}

/**
 * Navigation, in one of two models.
 *
 * **Glasses** (default): a plain in-memory stack. There is no URL bar, no back
 * button and no refresh, so the stack is the only history that exists and
 * middle-pinch pops it.
 *
 * **Web** (`urlBacked`): the browser's history IS the stack. Pushing a screen
 * pushes a history entry, in-app Back delegates to `history.back()`, and the
 * app adopts whatever the URL names on popstate. That is what makes the phone's
 * back gesture pop a screen instead of leaving the app, and what makes a screen
 * survive a refresh or arrive intact in a shared link — none of which worked
 * while navigation was purely in memory.
 */
export function NavigationProvider({
  children,
  urlBacked = false,
}: {
  children: ReactNode;
  urlBacked?: boolean;
}) {
  const [state, dispatch] = useReducer(navReducer, urlBacked, (backed) =>
    backed
      ? navReducer(initialNavState, { type: "SYNC", screen: screenFromLocation(currentHash()) })
      : initialNavState,
  );

  useEffect(() => {
    if (!urlBacked || typeof window === "undefined") return;
    // popstate covers back/forward; hashchange covers someone editing the URL
    // by hand. SYNC is idempotent, so handling both is harmless.
    const adopt = () => dispatch({ type: "SYNC", screen: screenFromLocation(window.location.hash) });
    window.addEventListener("popstate", adopt);
    window.addEventListener("hashchange", adopt);
    return () => {
      window.removeEventListener("popstate", adopt);
      window.removeEventListener("hashchange", adopt);
    };
  }, [urlBacked]);

  const value = useMemo<NavigationValue>(() => {
    /** Go to a screen, writing a history entry on web. */
    const go = (screen: Screen, replace = false) => {
      if (!urlBacked || typeof window === "undefined") {
        dispatch(replace ? { type: "REPLACE", screen } : { type: "PUSH", screen });
        return;
      }
      const url = `#${screenToPath(screen)}`;
      // pushState does not fire popstate, so the reducer is driven directly and
      // the listener above only ever handles genuine user navigation.
      if (replace) window.history.replaceState(null, "", url);
      else window.history.pushState(null, "", url);
      dispatch({ type: "SYNC", screen });
    };

    return {
      screen: currentScreen(state),
      canGoBack: canGoBack(state),
      push: (screen) => go(screen),
      replace: (screen) => go(screen, true),
      pop: () => {
        // Delegate to the browser so its entry is consumed too; otherwise the
        // URL would lag the screen and back would need pressing twice.
        if (urlBacked && typeof window !== "undefined") window.history.back();
        else dispatch({ type: "POP" });
      },
      home: () => go({ name: "home" }, true),
      openResults: (query) => go({ name: "results", query }),
      openDetails: (cardId, summary) => go({ name: "details", cardId, ...(summary ? { summary } : {}) }),
      openSets: () => go({ name: "sets" }),
      openSet: (setId, setName) => go({ name: "set", setId, setName }),
    };
  }, [state, urlBacked]);

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): NavigationValue {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error("useNavigation must be used within NavigationProvider");
  return ctx;
}
