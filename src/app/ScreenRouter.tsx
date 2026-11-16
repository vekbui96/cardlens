import { Suspense } from "react";
import { useNavigation } from "./NavigationProvider.tsx";
import { useIsWeb } from "./contexts.tsx";
import { HomeScreen } from "../features/home/HomeScreen.tsx";
import { LoadingState } from "../components/States.tsx";
import { Screen } from "../components/Screen.tsx";
import * as screens from "./screenLoaders.tsx";

// Home is eager (first screen); the rest are lazy to keep the initial bundle small.
// The loaders live in screenLoaders.tsx so the web shell can fetch a screen's
// chunk BEFORE it is tapped, through the very promise `lazy()` awaits.
const ResultsScreen = screens.ResultsScreen.Component;
const CardDetailsScreen = screens.CardDetailsScreen.Component;
const FavoritesScreen = screens.FavoritesScreen.Component;
const RecentScreen = screens.RecentScreen.Component;
const PopularScreen = screens.PopularScreen.Component;
const SetsScreen = screens.SetsScreen.Component;
const SetCardsScreen = screens.SetCardsScreen.Component;
/**
 * The first screen where the two shells genuinely diverge rather than differing
 * by a flag: a focus-ring list of text rows on the glasses, a tappable grid of
 * card art on a phone. Lazy and separate, so neither shell ships the other's
 * screen. Everything else is still shared and should stay that way until web
 * actually outgrows it.
 */
const WebSetCardsScreen = screens.WebSetCardsScreen.Component;
const WebSetsScreen = screens.WebSetsScreen.Component;
/**
 * Web Home is a dashboard, not a menu: the destinations the glasses Home lists
 * live in the app bar here, so repeating them down the page would make Home a
 * worse copy of a menu the user already has.
 */
const WebHomeScreen = screens.WebHomeScreen.Component;
/**
 * Web only, and lazy so the glasses never download it: a flat, sortable list of
 * every printing held. The shared Collection screen answers per-set progress,
 * which is the only shape that fits 600x600 — this answers what a single
 * printing is worth, which needs a price column and a sort the glasses cannot
 * drive with four gestures.
 */
const WebOwnedCardsScreen = screens.WebOwnedCardsScreen.Component;
/**
 * Web only: a table of sealed prices, which is the one shape a 600x600 additive
 * display cannot carry. Lazy, so the glasses never download it.
 */
const WebSealedScreen = screens.WebSealedScreen.Component;
/**
 * Camera, canvas and a 13KB index — none of which the glasses can use, so it is
 * lazy like the rest of the web-only screens and never lands on that bundle.
 */
const ScanScreen = screens.ScanScreen.Component;
/**
 * Web only: the Target restock watchlist. Text entry for a product URL and a
 * table of toggles — neither of which a keyboard-less 600x600 display can carry.
 */
const WebTargetScreen = screens.WebTargetScreen.Component;
/** A link someone was sent; most visitors will never open any other screen. */
const WebBindersScreen = screens.WebBindersScreen.Component;
const WebBinderScreen = screens.WebBinderScreen.Component;
const LiveShowcaseScreen = screens.LiveShowcaseScreen.Component;
/**
 * A trade link someone was sent. Like the showcase screens, most visitors who
 * open it will never open another screen in this app — so it is lazy, and it
 * asks for nothing the visitor has to have (no token, no collection).
 */
const TradeShareScreen = screens.TradeShareScreen.Component;
const ShowcaseScreen = screens.ShowcaseScreen.Component;
const CollectionScreen = screens.CollectionScreen.Component;

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
