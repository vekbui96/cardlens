import { lazy, Suspense } from "react";
import { useNavigation } from "./NavigationProvider.tsx";
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
const CollectionScreen = lazy(() =>
  import("../features/collection/CollectionScreen.tsx").then((m) => ({ default: m.CollectionScreen })),
);

export function ScreenRouter() {
  const { screen } = useNavigation();

  return (
    <Suspense
      fallback={
        <Screen title="CardLens">
          <LoadingState label="Loading…" />
        </Screen>
      }
    >
      {renderScreen(screen)}
    </Suspense>
  );
}

function renderScreen(screen: ReturnType<typeof useNavigation>["screen"]) {
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
      return <SetCardsScreen setId={screen.setId} setName={screen.setName} />;
    case "collection":
      return <CollectionScreen />;
    default:
      return <HomeScreen />;
  }
}
