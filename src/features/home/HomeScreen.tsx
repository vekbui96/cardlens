import { Screen } from "../../components/Screen.tsx";
import { FocusList } from "../../components/FocusList.tsx";
import { MenuRow } from "../../components/MenuRow.tsx";
import { useFocusList } from "../../hooks/useFocusList.ts";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useLibrary } from "../../app/LibraryProvider.tsx";
import { useScreenInputEnabled } from "../../app/TextEntryProvider.tsx";
import { useSearchAction } from "../search/useSearchAction.ts";
import { useSets } from "../../hooks/useSets.ts";
import { useIsWeb } from "../../app/contexts.tsx";
import { continueTarget, topProgress } from "./continueSet.ts";
import { SetProgressRow } from "../collection/SetProgressRow.tsx";

interface HomeItem {
  key: string;
  label: string;
  hint: string;
  onSelect: () => void;
}

export function HomeScreen() {
  const { push } = useNavigation();
  const {
    favorites,
    recentSearches,
    recentlyViewed,
    collection,
    ownedCountsBySet,
    ownedFinishCountsBySet,
    totalFinishesOwned,
    finishesBySet,
  } = useLibrary();
  const { typeSearch } = useSearchAction();
  const enabled = useScreenInputEnabled();
  const isWeb = useIsWeb();
  const { data: sets } = useSets();

  const resume = continueTarget(collection, sets, ownedCountsBySet, ownedFinishCountsBySet);
  const setCount = Object.keys(ownedCountsBySet).length;

  const items: HomeItem[] = [
    /**
     * Exactly ONE dynamic row, always at the top. Reordering the menu itself
     * would break the muscle memory that makes a four-gesture device usable at
     * all — "Sets is the fifth row" has to stay true.
     */
    ...(resume
      ? [
          {
            key: "continue",
            label: `▸ ${resume.setName}`,
            hint: resume.total
              ? `${resume.cards}/${resume.total} · ${resume.printings} printings`
              : `${resume.cards} cards · ${resume.printings} printings`,
            onSelect: () => push({ name: "set", setId: resume.setId, setName: resume.setName }),
          },
        ]
      : []),
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

  // The stat line replaces a generic tagline with the number actually worth
  // seeing on open. Falls back to the tagline before anything is collected.
  const subtitle = collection.length
    ? `${collection.length} cards · ${totalFinishesOwned} printings · ${setCount} ${setCount === 1 ? "set" : "sets"}`
    : "Search Pokémon cards";

  const progress = isWeb ? topProgress(ownedCountsBySet, sets) : [];

  return (
    <Screen title="CardLens" subtitle={subtitle}>
      <FocusList
        items={items}
        focusIndex={focusIndex}
        getKey={(item) => item.key}
        ariaLabel="Main menu"
        onActivate={(i) => items[i].onSelect()}
        renderItem={(item) => <MenuRow label={item.label} hint={item.hint} />}
      />
      {/* Web only: room for a dashboard. On the glasses every row costs roughly
          two card rows of list, so the stat line has to carry this instead. */}
      {progress.length > 0 ? (
        <div>
          {progress.map((row) => (
            <SetProgressRow
              key={row.setId}
              name={row.setName}
              owned={row.cards}
              printings={ownedFinishCountsBySet[row.setId] ?? row.cards}
              finishes={finishesBySet[row.setId] ?? {}}
              total={row.total}
              ratio={row.ratio}
            />
          ))}
        </div>
      ) : null}
    </Screen>
  );
}
