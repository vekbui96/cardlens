import { Screen } from "../../components/Screen.tsx";
import { FocusList } from "../../components/FocusList.tsx";
import { CardRow } from "../../components/CardRow.tsx";
import { MenuRow } from "../../components/MenuRow.tsx";
import { EmptyState } from "../../components/States.tsx";
import { useFocusList } from "../../hooks/useFocusList.ts";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useLibrary } from "../../app/LibraryProvider.tsx";
import { useScreenInputEnabled } from "../../app/TextEntryProvider.tsx";
import type { FavoriteCard, ViewedCard } from "../../storage/repositories.ts";

type RecentItem =
  | { kind: "search"; key: string; query: string }
  | { kind: "card"; key: string; card: ViewedCard | FavoriteCard };

/**
 * Recent searches (reopen without retyping) plus recently viewed cards — the
 * primary no-typing re-entry point on the glasses.
 */
export function RecentScreen() {
  const { openResults, openDetails, pop } = useNavigation();
  const { recentSearches, recentlyViewed } = useLibrary();
  const enabled = useScreenInputEnabled();

  const items: RecentItem[] = [
    ...recentSearches.map((r): RecentItem => ({ kind: "search", key: `s:${r.query}`, query: r.query })),
    ...recentlyViewed.map((c): RecentItem => ({ kind: "card", key: `c:${c.id}`, card: c })),
  ];

  const activate = (i: number) => {
    const item = items[i];
    if (!item) return;
    if (item.kind === "search") openResults(item.query);
    else openDetails(item.card.id, item.card);
  };

  const { focusIndex } = useFocusList({ count: items.length, enabled, onBack: pop, onSelect: activate });

  return (
    <Screen title="Recent" subtitle="Searches & viewed cards" canGoBack>
      {items.length === 0 ? (
        <EmptyState title="Nothing recent" hint="Your searches and viewed cards appear here." />
      ) : (
        <FocusList
          items={items}
          focusIndex={focusIndex}
          getKey={(item) => item.key}
          ariaLabel="Recent searches and cards"
          onActivate={activate}
          renderItem={(item) =>
            item.kind === "search" ? (
              <MenuRow label={item.query} hint="Search again" />
            ) : (
              <CardRow card={item.card} />
            )
          }
        />
      )}
    </Screen>
  );
}
