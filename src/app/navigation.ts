import type { PokemonCardSummary } from "../models/cards.ts";

/** One screen in the app. The app renders only the top of the stack. */
export type Screen =
  | { name: "home" }
  | { name: "results"; query: string }
  | { name: "details"; cardId: string; summary?: PokemonCardSummary }
  | { name: "favorites" }
  | { name: "recent" }
  | { name: "popular" }
  | { name: "sets" }
  | { name: "set"; setId: string; setName: string };

export type ScreenName = Screen["name"];

export interface NavState {
  stack: Screen[];
}

export type NavAction =
  { type: "PUSH"; screen: Screen } | { type: "REPLACE"; screen: Screen } | { type: "POP" } | { type: "HOME" };

export const initialNavState: NavState = { stack: [{ name: "home" }] };

export function navReducer(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case "PUSH":
      return { stack: [...state.stack, action.screen] };
    case "REPLACE":
      return { stack: [...state.stack.slice(0, -1), action.screen] };
    case "POP":
      // Never pop the root home screen.
      return state.stack.length > 1 ? { stack: state.stack.slice(0, -1) } : state;
    case "HOME":
      return initialNavState;
    default:
      return state;
  }
}

export function currentScreen(state: NavState): Screen {
  return state.stack[state.stack.length - 1];
}

export function canGoBack(state: NavState): boolean {
  return state.stack.length > 1;
}
