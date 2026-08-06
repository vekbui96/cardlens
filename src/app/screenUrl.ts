import type { Screen } from "./navigation.ts";

/**
 * Screen <-> URL mapping for the web shell.
 *
 * Hash-based, not path-based. GitHub Pages serves static files with no SPA
 * fallback, so `/cardlens/sets` would 404 on refresh or on a shared link —
 * there is no `sets/index.html` and no server config to add one. A hash keeps
 * every URL pointing at the one real document while still giving the browser
 * distinct history entries.
 *
 * The glasses do not use any of this. They have no URL bar, no back gesture
 * beyond middle-pinch, and a history stack the user cannot see would be a
 * second source of truth for nothing.
 */

/** The path (after the `#`) that names a screen. */
export function screenToPath(screen: Screen): string {
  switch (screen.name) {
    case "home":
      return "/";
    case "results":
      return `/search/${encodeURIComponent(screen.query)}`;
    case "details":
      return `/card/${encodeURIComponent(screen.cardId)}`;
    case "set":
      return `/set/${encodeURIComponent(screen.setId)}/${encodeURIComponent(screen.setName)}`;
    case "showcase":
      return `/showcase/${encodeURIComponent(screen.setId)}/${encodeURIComponent(screen.setName)}/${screen.payload}`;
    // Just the id: the set and its name come from the server, so they cannot
    // drift from what is actually being shared.
    case "live":
      return `/live/${encodeURIComponent(screen.shareId)}`;
    case "binder":
      return `/binder/${encodeURIComponent(screen.binderId)}`;
    default:
      return `/${screen.name}`;
  }
}

const SIMPLE = new Set([
  "favorites",
  "recent",
  "popular",
  "sets",
  "collection",
  "owned",
  "sealed",
  "scan",
  "target",
  "binders",
]);

/**
 * The screen a path names, or null when it names nothing we have.
 *
 * A card's `summary` is deliberately not carried in the URL: it is only an
 * instant-paint optimisation and the details screen refetches by id anyway.
 * Putting a whole card object in a link would make it long, stale and wrong.
 */
export function pathToScreen(path: string): Screen | null {
  const clean = path.replace(/^#/, "").replace(/\/+$/, "");
  if (clean === "" || clean === "/") return { name: "home" };

  const parts = clean.split("/").filter(Boolean).map(decodeURIComponent);
  const [head, ...rest] = parts;
  if (!head) return { name: "home" };

  if (SIMPLE.has(head) && rest.length === 0) return { name: head } as Screen;
  if (head === "search" && rest[0]) return { name: "results", query: rest.join("/") };
  if (head === "card" && rest[0]) return { name: "details", cardId: rest[0] };
  // The set name rides along because printings are matched to TCGdex by
  // normalised name, not by id — me5 there is me05.
  if (head === "set" && rest[0] && rest[1]) {
    return { name: "set", setId: rest[0], setName: rest.slice(1).join("/") };
  }
  // The payload is last and base64url, so it never contains a slash — the set
  // name in the middle still may.
  if (head === "showcase" && rest.length >= 3) {
    return {
      name: "showcase",
      setId: rest[0],
      setName: rest.slice(1, -1).join("/"),
      payload: rest[rest.length - 1],
    };
  }
  if (head === "binder" && rest.length >= 1) {
    return { name: "binder", binderId: rest[0] };
  }
  if (head === "live" && rest.length >= 1) {
    return { name: "live", shareId: rest[0] };
  }
  return null;
}

/** The screen the current location names, falling back to home. */
export function screenFromLocation(hash: string): Screen {
  return pathToScreen(hash) ?? { name: "home" };
}
