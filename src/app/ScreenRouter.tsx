import { lazy, Suspense } from "react";
import { useNavigation } from "./NavigationProvider.tsx";
import { useIsWeb } from "./contexts.tsx";
import { HomeScreen } from "../features/home/HomeScreen.tsx";
import { LoadingState } from "../components/States.tsx";
import { Screen } from "../components/Screen.tsx";

// Home is eager (first screen); the rest are lazy to keep the initial bundle small.
const ResultsScreen = lazy(() =>
  import("../features/results/ResultsScreen.tsx").then((m) => ({ default: m.ResultsScreen })),
);
const CardDetailsScreen = lazy(() =>
  import("../features/card-details/CardDetailsScreen.tsx").then((m) => ({ default: m.CardDetailsScreen })),
);
const FavoritesScreen = lazy(() =>
  import("../features/favorites/FavoritesScreen.tsx").then((m) => ({ default: m.FavoritesScreen })),
);
const RecentScreen = lazy(() =>
  import("../features/recent/RecentScreen.tsx").then((m) => ({ default: m.RecentScreen })),
);
const PopularScreen = lazy(() =>
  import("../features/popular/PopularScreen.tsx").then((m) => ({ default: m.PopularScreen })),
);
const SetsScreen = lazy(() =>
  import("../features/sets/SetsScreen.tsx").then((m) => ({ default: m.SetsScreen })),
);
const SetCardsScreen = lazy(() =>
  import("../features/sets/SetCardsScreen.tsx").then((m) => ({ default: m.SetCardsScreen })),
);
/**
 * The first screen where the two shells genuinely diverge rather than differing
 * by a flag: a focus-ring list of text rows on the glasses, a tappable grid of
 * card art on a phone. Lazy and separate, so neither shell ships the other's
 * screen. Everything else is still shared and should stay that way until web
 * actually outgrows it.
 */
const WebSetCardsScreen = lazy(() =>
  import("../web/sets/WebSetCardsScreen.tsx").then((m) => ({ default: m.WebSetCardsScreen })),
);
const CollectionScreen = lazy(() =>
  import("../features/collection/CollectionScreen.tsx").then((m) => ({ default: m.CollectionScreen })),
);

export function ScreenRouter() {
  const { screen } = useNavigation();
  const isWeb = useIsWeb();

  return (
    <Suspense
      fallback={
        <Screen title="CardLens">
          <LoadingState label="Loading…" />
        </Screen>
      }
    >
      {renderScreen(screen, isWeb)}
    </Suspense>
  );
}

function renderScreen(screen: ReturnType<typeof useNavigation>["screen"], isWeb: boolean) {
  switch (screen.name) {
    case "home":
      return <HomeScreen />;
    case "results":
      return <ResultsScreen query={screen.query} />;
    case "details":
      return (
        <CardDetailsScreen cardId={screen.cardId} {...(screen.summary ? { summary: screen.summary } : {})} />
      );
    case "favorites":
      return <FavoritesScreen />;
    case "recent":
      return <RecentScreen />;
    case "popular":
      return <PopularScreen />;
    case "sets":
      return <SetsScreen />;
    case "set":
      return isWeb ? (
        <WebSetCardsScreen setId={screen.setId} setName={screen.setName} />
      ) : (
        <SetCardsScreen setId={screen.setId} setName={screen.setName} />
      );
    case "collection":
      return <CollectionScreen />;
    default:
      return <HomeScreen />;
  }
}
