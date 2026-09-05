import { useMemo, useState } from "react";
import { useLibrary } from "../../../app/LibraryProvider.tsx";
import { useNavigation } from "../../../app/NavigationProvider.tsx";
import { useTextEntry } from "../../../app/TextEntryProvider.tsx";
import { screenToPath } from "../../../app/screenUrl.ts";
import { useSets } from "../../../hooks/useSets.ts";
import { syncLine } from "../../../features/collection/syncLine.ts";
import { Row, Stack, cx } from "../../primitives/index.ts";
import { OwnedView } from "./OwnedView.tsx";
import { SetsView } from "./SetsView.tsx";
import { ValuePanel } from "./ValuePanel.tsx";
import { groupSets, summaryLine } from "./setGroups.ts";
import styles from "./collection.module.css";

/**
 * Collection & sets — one screen, three routes.
 *
 * `#/sets` and `#/collection` used to be two menu entries answering nearly the
 * same question: Sets listed every set with "In progress" first, Collection
 * listed the sets you own cards from with the same progress on each. The second
 * was a subset of the first with a different row design, and a collector had to
 * remember which of the two they had opened to know whether they were seeing
 * everything. v1 merged them; this keeps them merged.
 *
 * `#/owned` is the third route and a MODE of this screen rather than a sibling.
 * It is the same collection read the other way round — by printing instead of
 * by set — so it shares the heading, the value panel and the summary line, and
 * the two are one link apart. Splitting it out would recreate exactly the
 * "which page am I on" problem the merge above removed. The shell already
 * agrees: `owned` lights the Collection nav entry.
 *
 * The screen takes no props. Which of the three routes is showing comes from
 * `useNavigation`, so the router can point all three names at this one export.
 *
 * ## Requests
 *
 * `useSets` (one call, cached a day) and `useLibraryValue` — which is the only
 * place that turns the live collection into priceable rows, and reaches
 * `/api/catalog/prices` through `useCatalogPrices` on the shared
 * `["catalog-prices", …]` key. Nothing here asks for a card. That endpoint
 * exists because the per-set path measured 4.5-6.7s a call across nineteen
 * sets, several of them failing, and left Home reporting "480 of 973 printings
 * priced"; a second query key here would pay that bill twice.
 */
export function CollectionScreen() {
  const { screen, push } = useNavigation();
  const {
    collection,
    ownedCountsBySet,
    ownedNumbersBySet,
    totalFinishesOwned,
    syncStatus,
    syncNow,
    setSyncToken,
  } = useLibrary();
  const { provider: textProvider } = useTextEntry();
  const { data, isLoading, isError, refetch } = useSets();
  const [query, setQuery] = useState("");

  const mode = screen.name === "owned" ? "owned" : "sets";

  const groups = useMemo(
    () => groupSets(data ?? [], ownedCountsBySet, ownedNumbersBySet, query),
    [data, ownedCountsBySet, ownedNumbersBySet, query],
  );

  /**
   * The sync row does the useful thing for the current state rather than
   * opening a settings screen: connect when off, re-enter when the token was
   * rejected, sync now when it is working. Same behaviour as v1 and as the
   * glasses, because a device connected on one shell must look connected on
   * the other.
   */
  const onSync = async () => {
    if (syncStatus.state === "off" || syncStatus.state === "bad-token") {
      const token = await textProvider.requestInput({
        title: "Sync token",
        placeholder: "paste from the server .env",
      });
      if (token) setSyncToken(token);
      return;
    }
    if (syncStatus.state === "disabled") return; // nothing the device can fix
    syncNow();
  };

  const sync = syncLine(syncStatus);
  const summary = summaryLine(collection.length, totalFinishesOwned, groups);

  return (
    <Stack gap={5}>
      <Stack gap={2}>
        <h1 className={styles.title}>Collection</h1>
        <p className={styles.summary} data-testid="collection-summary">
          {summary}
        </p>
      </Stack>

      <Row gap={3} wrap align="center">
        {/*
          Real links, because both are real URLs — middle-clickable, copyable,
          and read as links. The hash change is adopted by NavigationProvider,
          so no interception is needed for them to work.
        */}
        <nav className={styles.tabs} aria-label="Collection views">
          <Tab
            href={`#${screenToPath({ name: "collection" })}`}
            current={mode === "sets"}
            onGo={() => push({ name: "collection" })}
          >
            Sets
          </Tab>
          <Tab
            href={`#${screenToPath({ name: "owned" })}`}
            current={mode === "owned"}
            onGo={() => push({ name: "owned" })}
          >
            Everything owned
          </Tab>
        </nav>

        {/*
          Sync, where it can be acted on. A failed sync is a status and never a
          toast, so this is the only place it is offered — and the label counts
          minutes against a real clock, which is why snapshots skip it.
        */}
        <button
          type="button"
          className={cx(styles.button, styles.sync, sync.on && styles.syncOn)}
          onClick={() => void onSync()}
          aria-label={`${sync.label}. ${sync.hint || "No action available"}`}
          data-snapshot="volatile"
        >
          {sync.label}
        </button>
      </Row>

      <ValuePanel />

      {mode === "owned" ? (
        <OwnedView />
      ) : (
        <SetsView
          groups={groups}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => void refetch()}
          query={query}
          onQuery={setQuery}
          hasCollection={collection.length > 0}
        />
      )}
    </Stack>
  );
}

/**
 * One of the two views, as a link.
 *
 * `aria-current="page"` rather than colour alone, and the plain left click goes
 * through the router so the screen does not repaint from a hash round-trip;
 * every modified click (new tab, new window) is left to the browser.
 */
function Tab({
  href,
  current,
  onGo,
  children,
}: {
  href: string;
  current: boolean;
  onGo: () => void;
  children: string;
}) {
  return (
    <a
      className={cx(styles.tab, current && styles.tabCurrent)}
      href={href}
      {...(current ? { "aria-current": "page" as const } : {})}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onGo();
      }}
    >
      {children}
    </a>
  );
}
