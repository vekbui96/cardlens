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
const WebSetsScreen = lazy(() =>
  import("../web/sets/WebSetsScreen.tsx").then((m) => ({ default: m.WebSetsScreen })),
);
/**
 * Web Home is a dashboard, not a menu: the destinations the glasses Home lists
 * live in the app bar here, so repeating them down the page would make Home a
 * worse copy of a menu the user already has.
 */
const WebHomeScreen = lazy(() =>
  import("../web/home/WebHomeScreen.tsx").then((m) => ({ default: m.WebHomeScreen })),
);
/**
 * Web only, and lazy so the glasses never download it: a flat, sortable list of
 * every printing held. The shared Collection screen answers per-set progress,
 * which is the only shape that fits 600x600 — this answers what a single
 * printing is worth, which needs a price column and a sort the glasses cannot
 * drive with four gestures.
 */
const WebOwnedCardsScreen = lazy(() =>
  import("../web/collection/WebOwnedCardsScreen.tsx").then((m) => ({ default: m.WebOwnedCardsScreen })),
);
/**
 * Web only: a table of sealed prices, which is the one shape a 600x600 additive
 * display cannot carry. Lazy, so the glasses never download it.
 */
const WebSealedScreen = lazy(() =>
  import("../web/collection/WebSealedScreen.tsx").then((m) => ({ default: m.WebSealedScreen })),
);
/**
 * Camera, canvas and a 13KB index — none of which the glasses can use, so it is
 * lazy like the rest of the web-only screens and never lands on that bundle.
 */
const ScanScreen = lazy(() => import("../web/scan/ScanScreen.tsx").then((m) => ({ default: m.ScanScreen })));
/**
 * Web only: the Target restock watchlist. Text entry for a product URL and a
 * table of toggles — neither of which a keyboard-less 600x600 display can carry.
 */
const WebTargetScreen = lazy(() =>
  import("../web/target/WebTargetScreen.tsx").then((m) => ({ default: m.WebTargetScreen })),
);
/** A link someone was sent; most visitors will never open any other screen. */
const WebBindersScreen = lazy(() =>
  import("../web/binders/WebBindersScreen.tsx").then((m) => ({ default: m.WebBindersScreen })),
);
const WebBinderScreen = lazy(() =>
  import("../web/binders/WebBinderScreen.tsx").then((m) => ({ default: m.WebBinderScreen })),
);
const LiveShowcaseScreen = lazy(() =>
  import("../web/showcase/LiveShowcaseScreen.tsx").then((m) => ({ default: m.LiveShowcaseScreen })),
);
/**
 * A trade link someone was sent. Like the showcase screens, most visitors who
 * open it will never open another screen in this app — so it is lazy, and it
 * asks for nothing the visitor has to have (no token, no collection).
 */
const TradeShareScreen = lazy(() =>
  import("../web/trade/TradeShareScreen.tsx").then((m) => ({ default: m.TradeShareScreen })),
);
const ShowcaseScreen = lazy(() =>
  import("../web/showcase/ShowcaseScreen.tsx").then((m) => ({ default: m.ShowcaseScreen })),
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
      return isWeb ? <WebHomeScreen /> : <HomeScreen />;
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
      return isWeb ? <WebSetsScreen /> : <SetsScreen />;
    case "set":
      return isWeb ? (
        <WebSetCardsScreen setId={screen.setId} setName={screen.setName} />
      ) : (
        <SetCardsScreen setId={screen.setId} setName={screen.setName} />
      );
    // One screen on the web: Sets and Collection answered nearly the same
    // question from two menu entries, and Collection was a subset of Sets with
    // a different row design. The glasses keep their own — a 600x600 additive
    // display has room for a progress list and nothing else.
    case "collection":
      return isWeb ? <WebSetsScreen /> : <CollectionScreen />; // Reachable on the glasses only via a shared URL, which they have no way to
    // open — but falling back to Collection beats rendering nothing if it ever is.
    case "owned":
      return isWeb ? <WebOwnedCardsScreen /> : <CollectionScreen />;
    case "sealed":
      return isWeb ? <WebSealedScreen /> : <CollectionScreen />;
    case "scan":
      return isWeb ? <ScanScreen /> : <CollectionScreen />;
    case "target":
      return isWeb ? <WebTargetScreen /> : <CollectionScreen />;
    case "binders":
      // Web only: laying out a page needs a pointer and a grid the glasses
      // have no room for.
      return isWeb ? <WebBindersScreen /> : <CollectionScreen />;
    case "binder":
      return isWeb ? <WebBinderScreen binderId={screen.binderId} /> : <CollectionScreen />;
    case "live":
      // Falls back to Collection on the glasses for the same reason showcase
      // does: they have no way to open a link.
      return isWeb ? <LiveShowcaseScreen shareId={screen.shareId} /> : <CollectionScreen />;
    case "trade":
      return isWeb ? <TradeShareScreen shareId={screen.shareId} /> : <CollectionScreen />;
    case "showcase":
      return isWeb ? (
        <ShowcaseScreen setId={screen.setId} setName={screen.setName} payload={screen.payload} />
      ) : (
        <SetCardsScreen setId={screen.setId} setName={screen.setName} />
      );
    default:
      return isWeb ? <WebHomeScreen /> : <HomeScreen />;
  }
}
