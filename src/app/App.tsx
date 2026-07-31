import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InputProvider, CatalogProvider, RepositoriesProvider } from "./contexts.tsx";
import { NavigationProvider } from "./NavigationProvider.tsx";
import { LibraryProvider } from "./LibraryProvider.tsx";
import { TextEntryProvider } from "./TextEntryProvider.tsx";
import { ScreenRouter } from "./ScreenRouter.tsx";
import { GlassesFrame } from "../components/GlassesFrame.tsx";
import { layoutOverrideFromLocation, resolveLayoutMode, type LayoutMode } from "./layoutMode.ts";
import { DevPanel } from "../components/dev/DevPanel.tsx";
import { migrateStorage } from "../storage/versioned.ts";

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

  useEffect(() => {
    migrateStorage();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <InputProvider>
        <RepositoriesProvider>
          <CatalogProvider>
            <NavigationProvider>
              <LibraryProvider>
                <TextEntryProvider>
                  <GlassesFrame
                    chrome={isDesktop}
                    web={mode === "web"}
                    scale={scale}
                    aside={showDevPanel ? <DevPanel onScaleChange={setScale} /> : undefined}
                  >
                    <ScreenRouter />
                  </GlassesFrame>
                </TextEntryProvider>
              </LibraryProvider>
            </NavigationProvider>
          </CatalogProvider>
        </RepositoriesProvider>
      </InputProvider>
    </QueryClientProvider>
  );
}
