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
  | { name: "set"; setId: string; setName: string }
  | { name: "collection" }
  /** Web only: every printing held, as one sortable list. See ScreenRouter. */
  | { name: "owned" }
  /** Web only: current sealed product prices for the sets you collect. */
  | { name: "sealed" }
  /** Web only: the Target restock watchlist and the bot's own health. */
  | { name: "target" }
  /** Web only: recognise a card through the camera. Needs a pointer and a lens. */
  | { name: "scan" }
  /**
   * Web only: somebody else's set, read from the link rather than this device.
   * `payload` is the encoded ownership — see models/showcase.ts.
   */
  | { name: "showcase"; setId: string; setName: string; payload: string }
  /**
   * Web only: somebody else's set, read LIVE from the server rather than from
   * the link. Same page as `showcase`, but the data can change after it was
   * sent — see server/shareStore.ts.
   */
  | { name: "live"; shareId: string }
  /** Web only: binders you lay out yourself. */
  | { name: "binders" }
  | { name: "binder"; binderId: string }
  /**
   * Web only: somebody's binder, offered for trade, read live from the server.
   *
   * Its own screen rather than a mode of `live` because the two answer opposite
   * questions. A live set share says what its owner HAS — progress through a
   * set, drawn against their collection. A trade share says what its owner will
   * GIVE UP, priced per copy and addressed by pocket so the two of you can talk
   * about it. Same share id space; different page.
   */
  | { name: "trade"; shareId: string }
  /**
   * v2 and development only: every primitive, in every state, against
   * fixtures. It is a screen rather than a separate entry point so that it
   * renders inside the real shell — a component gallery that mounts outside
   * the app is a gallery that disagrees with the app.
   *
   * v1's router has no case for it and falls through to Home, which is the
   * right answer there: the primitives it would show do not exist in v1.
   */
  | { name: "workshop" };
export type ScreenName = Screen["name"];

export interface NavState {
  stack: Screen[];
}

export type NavAction =
  | { type: "PUSH"; screen: Screen }
  | { type: "REPLACE"; screen: Screen }
  | { type: "POP" }
  | { type: "HOME" }
  /**
   * Web only: adopt whatever screen the URL now names.
   *
   * On the web shell the BROWSER holds the history — its back button, its
   * entries, its refresh. Keeping a second deep stack in memory alongside it
   * would be two sources of truth that drift the moment someone hits back twice
   * or opens a link cold. So the in-memory stack is flattened to at most
   * [home, screen]: enough for `canGoBack` and an in-app Back control, with the
   * real depth living where the user can see it.
   */
  | { type: "SYNC"; screen: Screen };

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
    case "SYNC":
      return action.screen.name === "home" ? initialNavState : { stack: [{ name: "home" }, action.screen] };
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
