import { Screen } from "../../components/Screen.tsx";
import { FocusList } from "../../components/FocusList.tsx";
import { MenuRow } from "../../components/MenuRow.tsx";
import { useFocusList } from "../../hooks/useFocusList.ts";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useScreenInputEnabled } from "../../app/TextEntryProvider.tsx";
import { useSearchAction } from "../search/useSearchAction.ts";
import { POPULAR_POKEMON } from "../../integrations/pokemon/fixtures.ts";

/** No-typing search shortcuts — pick a popular Pokémon to search it instantly. */
export function PopularScreen() {
  const { pop } = useNavigation();
  const { run } = useSearchAction();
  const enabled = useScreenInputEnabled();
  const names = POPULAR_POKEMON;

  const { focusIndex } = useFocusList({
    count: names.length,
    enabled,
    onBack: pop,
    onSelect: (i) => run(names[i]),
  });

  return (
    <Screen title="Popular" subtitle="Tap to search — no typing" canGoBack>
      <FocusList
        items={names as readonly string[] as string[]}
        focusIndex={focusIndex}
        getKey={(name) => name}
        ariaLabel="Popular Pokémon"
        onActivate={(i) => run(names[i])}
        renderItem={(name) => <MenuRow label={name} hint="Search" />}
      />
    </Screen>
  );
}
