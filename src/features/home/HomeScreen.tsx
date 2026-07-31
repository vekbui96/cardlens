import { Screen } from "../../components/Screen.tsx";
import { FocusList } from "../../components/FocusList.tsx";
import { MenuRow } from "../../components/MenuRow.tsx";
import { useFocusList } from "../../hooks/useFocusList.ts";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useLibrary } from "../../app/LibraryProvider.tsx";
import { useScreenInputEnabled } from "../../app/TextEntryProvider.tsx";
import { useSearchAction } from "../search/useSearchAction.ts";

interface HomeItem {
  key: string;
  label: string;
  hint: string;
  onSelect: () => void;
}

export function HomeScreen() {
  const { push } = useNavigation();
  const { favorites, recentSearches, recentlyViewed, collection } = useLibrary();
  const { typeSearch } = useSearchAction();
  const enabled = useScreenInputEnabled();

  const items: HomeItem[] = [
    { key: "search", label: "Search", hint: "Type or use phone", onSelect: () => void typeSearch() },
    {
      key: "recent",
      label: "Recent",
      hint: recentSearches.length || recentlyViewed.length ? `${recentSearches.length} searches` : "None yet",
      onSelect: () => push({ name: "recent" }),
    },
    {
      key: "favorites",
      label: "Favorites",
      hint: favorites.length ? `${favorites.length} saved` : "None yet",
      onSelect: () => push({ name: "favorites" }),
    },
    {
      key: "collection",
      label: "Collection",
      hint: collection.length ? `${collection.length} cards` : "Track your sets",
      onSelect: () => push({ name: "collection" }),
    },
    { key: "popular", label: "Popular", hint: "Top Pokémon", onSelect: () => push({ name: "popular" }) },
    { key: "sets", label: "Sets", hint: "Browse by set", onSelect: () => push({ name: "sets" }) },
  ];

  const { focusIndex } = useFocusList({
    count: items.length,
    onSelect: (i) => items[i].onSelect(),
    enabled,
  });

  return (
    <Screen title="CardLens" subtitle="Search Pokémon cards">
      <FocusList
        items={items}
        focusIndex={focusIndex}
        getKey={(item) => item.key}
        ariaLabel="Main menu"
        onActivate={(i) => items[i].onSelect()}
        renderItem={(item) => <MenuRow label={item.label} hint={item.hint} />}
      />
    </Screen>
  );
}
