import { lazy, Suspense, useMemo } from "react";
import { Screen } from "../../components/Screen.tsx";
import { BackRow } from "../../components/BackRow.tsx";
import { LoadingState, ErrorState, EmptyState } from "../../components/States.tsx";
import { useSets } from "../../hooks/useSets.ts";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useLibrary } from "../../app/LibraryProvider.tsx";
import { ToggleRow } from "../../components/ToggleRow.tsx";
import { useTextEntry } from "../../app/TextEntryProvider.tsx";
import { syncLine } from "../../features/collection/syncLine.ts";
import { setTiers } from "../../models/setCompletion.ts";
import { compareCompletion, ownedIn, tierLabel } from "../../features/collection/completionTier.ts";
import { SetTierFigures } from "../../features/collection/SetTierFigures.tsx";
import styles from "./WebSetsScreen.module.css";

const ValuePanel = lazy(() =>
  import("../collection/ValuePanel.tsx").then((m) => ({ default: m.ValuePanel })),
);

/**
 * The collection AND the sets, which on the web are one screen.
 *
 * They used to be two menu entries answering nearly the same question. Sets
 * listed every set with "In progress" first; Collection listed the sets you own
 * cards from with the same progress on each. The second was a subset of the
 * first with a different row design, and a collector had to remember which of
 * the two they had opened to know whether they were seeing everything.
 *
 * So this screen is the whole answer: what the collection is worth, what needs
 * syncing, what you are part-way through, and then everything else. The glasses
 * keep their own `CollectionScreen` — a 600x600 additive display has room for a
 * progress list and nothing else, which is exactly why these diverged.
 *
 * Sets you have started still come first. A tracker's landing screen should
 * open on what you are working on, not on whatever released most recently.
 */
export function WebSetsScreen() {
  const { openSet, pop } = useNavigation();
  const { data, isLoading, isError, refetch } = useSets();
  const {
    ownedCountsBySet,
    ownedNumbersBySet,
    collection,
    totalFinishesOwned,
    syncStatus,
    syncNow,
    setSyncToken,
  } = useLibrary();
  const { provider: textProvider } = useTextEntry();
  // No disconnect here. On the glasses it is a deliberate left-swipe on the
  // sync row -- the only spare gesture there -- and forgetting a device's
  // token is rare enough to be worth burying. A pointer has no equivalent,
  // and the web shell never offered it either.

  /**
   * The sync row does the useful thing for the current state rather than
   * opening a settings screen: connect when off, retry when stuck, disconnect
   * when working. Same behaviour as the glasses Collection screen, because a
   * device connected on one shell must look connected on the other.
   */
  const onSyncSelect = async () => {
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
  /**
   * Three groups, not two.
   *
   * A set whose base run is finished is not "in progress" — it is the thing the
   * heading promises you are still working on, and leaving it there means
   * scrolling past your own trophies to find the sets that still need cards.
   * Master-complete sets sort above base-complete ones inside the finished
   * group, since once the ratio is base every base-complete set ties at 1.0.
   */
  const sets = useMemo(() => {
    const all = data ?? [];
    const tiersFor = (set: (typeof all)[number]) =>
      setTiers(
        {
          ...(set.total ? { total: set.total } : {}),
          ...(set.printedTotal ? { printedTotal: set.printedTotal } : {}),
        },
        ownedIn(set.id, ownedNumbersBySet, ownedCountsBySet[set.id] ?? 0),
      );
    const started = all
      .filter((s) => (ownedCountsBySet[s.id] ?? 0) > 0)
      .map((set) => ({ set, tiers: tiersFor(set), owned: ownedCountsBySet[set.id] ?? 0 }))
      .sort(compareCompletion);
    return {
      inProgress: started.filter((s) => s.tiers.tier === "none"),
      complete: started.filter((s) => s.tiers.tier !== "none"),
      started,
      rest: all
        .filter((s) => (ownedCountsBySet[s.id] ?? 0) === 0)
        .map((set) => ({ set, tiers: tiersFor(set), owned: 0 })),
    };
  }, [data, ownedCountsBySet, ownedNumbersBySet]);

  const row = ({ set, tiers, owned }: (typeof sets.started)[number]) => {
    const total = set.total;
    const base = tiers.baseTotal !== undefined;
    const label = tierLabel(tiers.tier);
    return (
      <li key={set.id}>
        <button
          type="button"
          className={styles.row}
          onClick={() => openSet(set.id, set.name)}
          aria-label={
            base
              ? `${set.name}, base set ${tiers.baseOwned} of ${tiers.baseTotal}, master set ${tiers.masterOwned} of ${total}${label ? `, ${label} complete` : ""}`
              : total
                ? `${set.name}, ${owned} of ${total} cards${label ? `, ${label} complete` : ""}`
                : `${set.name}, ${owned} cards tracked`
          }
        >
          {set.logoImage ? (
            <img className={styles.logo} src={set.logoImage} alt="" loading="lazy" decoding="async" />
          ) : (
            <span className={styles.logoFallback} aria-hidden="true">
              {set.code ?? set.id}
            </span>
          )}
          <span className={styles.text}>
            <span className={styles.name}>{set.name}</span>
            <span className={styles.meta}>
              {set.code ? <span className={styles.code}>{set.code}</span> : null}
              {set.releaseDate ? <span>{set.releaseDate.slice(0, 4)}</span> : null}
              {/* The set size, but only where the row is not already showing it.
                  A started row carries `197/230 master` on the right, and
                  printing "230 cards" beside it was the same number twice — at
                  the cost of the width that pushed the set NAME into an
                  ellipsis on a 320px desktop column. */}
              {total && owned === 0 ? <span className={styles.count}>{total} cards</span> : null}
            </span>
          </span>
          {owned > 0 ? <SetTierFigures tiers={tiers} owned={owned} /> : null}
        </button>
      </li>
    );
  };

  /*
   * Counted by the one predicate, not by `owned === total`. That expression
   * disagreed with the two rounded percentages elsewhere on this screen, and it
   * could only ever see the master tier. `master` implies base, so a
   * master-complete set is counted in both figures.
   */
  const masterDone = sets.complete.filter((s) => s.tiers.tier === "master").length;
  const milestones = [
    ...(sets.complete.length ? [`${sets.complete.length} base`] : []),
    ...(masterDone ? [`${masterDone} master`] : []),
  ].join(" · ");
  const subtitle = collection.length
    ? `${collection.length} cards · ${totalFinishesOwned} printings · ${sets.started.length} sets${
        milestones ? ` · ${milestones}` : ""
      }`
    : "Nothing tracked yet";
  const sync = syncLine(syncStatus);

  return (
    <Screen
      title="Collection"
      subtitle={subtitle}
      headerLeft={<BackRow focused={false} onActivate={pop} />}
      canGoBack
    >
      {/* Sync first: if the device is not connected, that is the thing most
          worth knowing before reading any number below it. */}
      <ToggleRow
        label={sync.label}
        hint={sync.hint}
        on={sync.on}
        focused={false}
        onActivate={() => void onSyncSelect()}
      />
      {/* Lazy, so the glasses never download a table of prices they have no
          room to draw. Shows the five most valuable sets and folds the rest. */}
      <Suspense fallback={null}>
        <ValuePanel />
      </Suspense>
      {isLoading ? <LoadingState label="Loading sets…" /> : null}{" "}
      {isError ? (
        <ErrorState message="Couldn’t load sets" onRetry={() => void refetch()} retryFocused={false} />
      ) : null}
      {!isLoading && !isError && sets.started.length + sets.rest.length === 0 ? (
        <EmptyState title="No sets loaded" hint="Try again in a moment." />
      ) : null}
      {sets.inProgress.length > 0 ? (
        <>
          <h2 className={styles.group}>In progress</h2>
          <ul className={styles.list}>{sets.inProgress.map(row)}</ul>
        </>
      ) : null}
      {/* Finished sets are not something you are working on, so they sit under
          their own heading rather than at the top of the working list. */}
      {sets.complete.length > 0 ? (
        <>
          <h2 className={styles.group}>Completed</h2>
          <ul className={styles.list}>{sets.complete.map(row)}</ul>
        </>
      ) : null}
      {sets.rest.length > 0 ? (
        <>
          {sets.started.length > 0 ? <h2 className={styles.group}>All sets</h2> : null}
          <ul className={styles.list}>{sets.rest.map(row)}</ul>
        </>
      ) : null}
    </Screen>
  );
}
