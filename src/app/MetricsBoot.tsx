import { useEffect } from "react";
import { useRepositories } from "./contexts.tsx";
import { useNavigation } from "./NavigationProvider.tsx";
import { screenToPath } from "./screenUrl.ts";
import { screenTitle } from "./documentTitle.ts";
import type { LayoutMode } from "./layoutMode.ts";
import type { UiVersion } from "./uiVersion.ts";
import { configureMetrics, track, trackScreen } from "../services/metrics.ts";

/**
 * Wires usage metrics to the app, and counts the two things every shell shares:
 * which layout it is running in, and which screen is on top.
 *
 * Screen views are counted here rather than in each screen so the glasses' in-
 * memory stack and the web's URL-backed history are counted the same way, by
 * what is actually showing. Keyed on the screen's path so the duplicate SYNC
 * that popstate and hashchange both dispatch is one view, not two — the path is
 * only a dedupe key and never leaves the device; the name alone is counted.
 *
 * Renders nothing and owns no state any screen reads.
 */
export function MetricsBoot({ mode, uiVersion }: { mode: LayoutMode; uiVersion: UiVersion }) {
  const repo = useRepositories();
  const { screen } = useNavigation();

  useEffect(() => {
    configureMetrics({ getToken: () => repo.getSyncSettings().token });
  }, [repo]);

  useEffect(() => track(`layout.${mode}`), [mode]);
  useEffect(() => track(`ui.${uiVersion}`), [uiVersion]);

  const key = screenToPath(screen);
  const name = screen.name;
  useEffect(() => trackScreen(name), [key, name]);

  // The browser tab names the screen on the web shell; the glasses keep the
  // static index.html title.
  useEffect(() => {
    if (mode !== "web") return;
    document.title = screenTitle(name);
  }, [mode, name]);

  return null;
}
