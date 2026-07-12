import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";
import { App } from "./app/App.tsx";
import { CompanionPage } from "./pages/CompanionPage.tsx";
import { PrivacyPage } from "./pages/PrivacyPage.tsx";

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
  return <App />;
}

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");

createRoot(container).render(<StrictMode>{pickRoot()}</StrictMode>);
