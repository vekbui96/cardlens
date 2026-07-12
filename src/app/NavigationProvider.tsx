import { createContext, useContext, useMemo, useReducer, type ReactNode } from "react";
import type { PokemonCardSummary } from "../models/cards.ts";
import { canGoBack, currentScreen, initialNavState, navReducer, type Screen } from "./navigation.ts";

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

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(navReducer, initialNavState);

  const value = useMemo<NavigationValue>(
    () => ({
      screen: currentScreen(state),
      canGoBack: canGoBack(state),
      push: (screen) => dispatch({ type: "PUSH", screen }),
      replace: (screen) => dispatch({ type: "REPLACE", screen }),
      pop: () => dispatch({ type: "POP" }),
      home: () => dispatch({ type: "HOME" }),
      openResults: (query) => dispatch({ type: "PUSH", screen: { name: "results", query } }),
      openDetails: (cardId, summary) =>
        dispatch({ type: "PUSH", screen: { name: "details", cardId, ...(summary ? { summary } : {}) } }),
      openSets: () => dispatch({ type: "PUSH", screen: { name: "sets" } }),
      openSet: (setId, setName) => dispatch({ type: "PUSH", screen: { name: "set", setId, setName } }),
    }),
    [state],
  );

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): NavigationValue {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error("useNavigation must be used within NavigationProvider");
  return ctx;
}
