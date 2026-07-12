import { Screen } from "../../components/Screen.tsx";
import { FocusList } from "../../components/FocusList.tsx";
import { CardRow } from "../../components/CardRow.tsx";
import { BackRow } from "../../components/BackRow.tsx";
import { EmptyState } from "../../components/States.tsx";
import { useBackableFocus } from "../../hooks/useBackableFocus.ts";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useLibrary } from "../../app/LibraryProvider.tsx";
import { useScreenInputEnabled } from "../../app/TextEntryProvider.tsx";

export function FavoritesScreen() {
  const { openDetails, pop } = useNavigation();
  const { favorites } = useLibrary();
  const enabled = useScreenInputEnabled();

  const { backFocused, itemIndex } = useBackableFocus({
    count: favorites.length,
    enabled,
    onBack: pop,
    onSelect: (i) => favorites[i] && openDetails(favorites[i].id, favorites[i]),
  });

  return (
    <Screen title="Favorites" canGoBack>
      <BackRow focused={backFocused} onActivate={pop} />
      {favorites.length === 0 ? (
        <EmptyState title="No favorites yet" hint="Open a card and choose Favorite to save it here." />
      ) : (
        <FocusList
          items={favorites}
          focusIndex={itemIndex}
          getKey={(c) => c.id}
          ariaLabel="Favorite cards"
          onActivate={(i) => openDetails(favorites[i].id, favorites[i])}
          renderItem={(card) => <CardRow card={card} />}
        />
      )}
    </Screen>
  );
}
