import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";
import { App } from "./app/App.tsx";
import { ErrorBoundary } from "./app/ErrorBoundary.tsx";
import { CompanionPage } from "./pages/CompanionPage.tsx";
import { PrivacyPage } from "./pages/PrivacyPage.tsx";
import { isWebMode, layoutOverrideFromLocation, resolveLayoutMode } from "./app/layoutMode.ts";

/**
 * Tiny path router. The glasses app is a single-screen state machine; only the
 * companion (/input/:code) and /privacy are separate top-level pages. Kept
 * dependency-free to honor the lean-bundle requirement. Base-aware so it works
 * when hosted under a subpath (e.g. GitHub Pages at /cardlens/).
 */
function pickRoot() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, ""); // "" at root, "/cardlens" on Pages
  const path = window.location.pathname.slice(base.length) || "/";
  if (path.startsWith("/input/")) return <CompanionPage />;
  if (path === "/privacy") return <PrivacyPage />;
  // Only the app route reaches a Home screen; the companion and privacy pages
  // would be fetching a chunk they never render.
  warmFirstScreen();
  return <App />;
}

/**
 * Start fetching the first screen's chunk now, not when React gets round to
 * rendering it.
 *
 * Both Home screens are lazy on the web side so neither shell ships the other's
 * (see ScreenRouter), and the cost of that is a serialised request: the browser
 * cannot know it needs WebHomeScreen until this bundle has downloaded, parsed
 * and mounted. Measured on the live site, the entry chunks settled at 246ms and
 * the home chunk only STARTED at 267ms — and the Suspense fallback is on screen
 * for the whole of that gap.
 *
 * Firing the same import here overlaps it with mounting instead. It is the
 * identical module specifier, so this warms the exact chunk `lazy()` awaits
 * rather than fetching a second copy, and a failure is React's to report when
 * it re-imports — hence the bare catch.
 */
function warmFirstScreen(): void {
  const mode = resolveLayoutMode(window.innerWidth, window.innerHeight, layoutOverrideFromLocation());
  // The glasses Home is eager and already in this bundle; only web pays.
  if (!isWebMode(mode)) return;
  void import("./web/home/WebHomeScreen.tsx").catch(() => {});
}

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");

// Outside StrictMode's child, so a throw during the initial render is caught
// too — that is the case that produces a completely blank page.
createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>{pickRoot()}</ErrorBoundary>
  </StrictMode>,
);
