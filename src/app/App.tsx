import { lazy, Suspense, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InputProvider, CatalogProvider, RepositoriesProvider, LayoutModeProvider } from "./contexts.tsx";
import { NavigationProvider } from "./NavigationProvider.tsx";
import { LibraryProvider } from "./LibraryProvider.tsx";
import { TextEntryProvider } from "./TextEntryProvider.tsx";
import { ScreenRouter } from "./ScreenRouter.tsx";
import { GlassesFrame } from "../components/GlassesFrame.tsx";
import { layoutOverrideFromLocation, resolveLayoutMode, type LayoutMode } from "./layoutMode.ts";
import { DevPanel } from "../components/dev/DevPanel.tsx";
import { migrateStorage } from "../storage/versioned.ts";
import { activeUiVersion } from "./uiVersion.ts";

/**
 * The rebuild, behind one lazy import.
 *
 * Lazy is what keeps v2 off a v1 user's wire: nothing in `src/v2/` is reachable
 * from the entry chunk except through this line. `e2e/v2/bundle.spec.ts`
 * asserts that against the built output rather than trusting it, because a
 * single eager import added anywhere in `src/v2/` would silently undo it.
 */
const V2App = lazy(() => import("../v2/V2App.tsx").then((m) => ({ default: m.V2App })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false, // avoid continuous background requests on wearable
      gcTime: 30 * 60_000,
    },
  },
});

function devPanelEnabled(): boolean {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_ENABLE_DEV_PANEL !== "false";
}

/**
 * On the glasses the viewport is exactly 600x600, so we render the raw surface.
 * On a larger desktop viewport we show the preview bezel + DevPanel.
 */
function useLayoutMode(): LayoutMode {
  const read = () =>
    typeof window === "undefined"
      ? "preview"
      : resolveLayoutMode(window.innerWidth, window.innerHeight, layoutOverrideFromLocation());

  const [mode, setMode] = useState<LayoutMode>(read);
  useEffect(() => {
    const onResize = () => setMode(read());
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);
  return mode;
}

export function App() {
  const mode = useLayoutMode();
  const isDesktop = mode === "preview";
  const [scale, setScale] = useState(1);
  const showDevPanel = isDesktop && devPanelEnabled();
  /**
   * Resolved once per render from the mode, and never for the glasses — v2 is
   * a web rebuild, and `activeUiVersion` returns v1 for `glasses` and `preview`
   * whatever the flag says, so no v2 code can mount on the device.
   */
  const uiVersion = activeUiVersion(mode);
  const isV2 = uiVersion === "v2";

  useEffect(() => {
    migrateStorage();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {/*
        Every provider below is SHARED by both versions, and deliberately above
        the version branch. A second QueryClient — or a second Repositories, or
        a second Library — would mean two caches, two sets of requests, and a
        sync racing itself. v2 mounts no providers of its own.
      */}
      <InputProvider wearable={!isV2}>
        <RepositoriesProvider>
          <CatalogProvider>
            <LayoutModeProvider mode={mode}>
              {/*
                Only the web shell gets URL-backed navigation. The glasses have
                no URL bar and preview deliberately mimics them, so a history
                stack there would be a second source of truth for nothing.
              */}
              <NavigationProvider urlBacked={mode === "web"}>
                <LibraryProvider>
                  <TextEntryProvider>
                    {isV2 ? (
                      // No fallback UI: v2 paints its own shell the moment the
                      // chunk lands, and a spinner that flashes for one frame
                      // is worse than the frame it replaces.
                      <Suspense fallback={null}>
                        <V2App />
                      </Suspense>
                    ) : (
                      <GlassesFrame
                        chrome={isDesktop}
                        web={mode === "web"}
                        scale={scale}
                        aside={showDevPanel ? <DevPanel onScaleChange={setScale} /> : undefined}
                      >
                        <ScreenRouter />
                      </GlassesFrame>
                    )}
                  </TextEntryProvider>
                </LibraryProvider>
              </NavigationProvider>
            </LayoutModeProvider>
          </CatalogProvider>
        </RepositoriesProvider>
      </InputProvider>
    </QueryClientProvider>
  );
}
