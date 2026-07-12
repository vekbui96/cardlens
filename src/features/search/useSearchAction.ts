import { useCallback } from "react";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useLibrary } from "../../app/LibraryProvider.tsx";
import { useTextEntry } from "../../app/TextEntryProvider.tsx";

const REQUEST = { title: "Search cards", placeholder: "e.g. Charizard ex" };

/**
 * The one place that turns a chosen query into a search: records it as a recent
 * search and opens the results screen. Also exposes the text-entry entry points
 * (browser modal or companion phone), honoring the glasses' no-keyboard reality.
 */
export function useSearchAction() {
  const { openResults } = useNavigation();
  const { addRecentSearch } = useLibrary();
  const { provider, requestCompanion } = useTextEntry();

  const run = useCallback(
    (query: string) => {
      const q = query.trim();
      if (!q) return;
      addRecentSearch(q);
      openResults(q);
    },
    [addRecentSearch, openResults],
  );

  /** Primary "Search" action: browser prompt on desktop, on-glasses picker on glasses. */
  const typeSearch = useCallback(async () => {
    const value = await provider.requestInput(REQUEST);
    if (value) run(value);
  }, [provider, run]);

  /** Explicit "Use phone" action. */
  const phoneSearch = useCallback(async () => {
    const value = await requestCompanion(REQUEST);
    if (value) run(value);
  }, [requestCompanion, run]);

  return { run, typeSearch, phoneSearch };
}
