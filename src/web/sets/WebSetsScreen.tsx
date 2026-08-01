import { useMemo } from "react";
import { Screen } from "../../components/Screen.tsx";
import { BackRow } from "../../components/BackRow.tsx";
import { LoadingState, ErrorState, EmptyState } from "../../components/States.tsx";
import { useSets } from "../../hooks/useSets.ts";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useLibrary } from "../../app/LibraryProvider.tsx";
import styles from "./WebSetsScreen.module.css";

/**
 * Sets, for a phone or a desktop.
 *
 * The glasses list a set as a line of text because that is all a 600x600
 * additive display has room for. Here the set's own logo is the fastest thing to
 * recognise, and the question a collector is actually asking — how far through
 * am I — deserves to be answered on this screen rather than one tap later.
 *
 * Sets you have started come first. A tracker's landing screen should open on
 * what you are working on, not on whatever released most recently.
 */
export function WebSetsScreen() {
  const { openSet, pop } = useNavigation();
  const { data, isLoading, isError, refetch } = useSets();
  const { ownedCountsBySet } = useLibrary();

  const sets = useMemo(() => {
    const all = data ?? [];
    const started = all.filter((s) => (ownedCountsBySet[s.id] ?? 0) > 0);
    const rest = all.filter((s) => (ownedCountsBySet[s.id] ?? 0) === 0);
    return { started, rest };
  }, [data, ownedCountsBySet]);

  const row = (set: (typeof sets.started)[number]) => {
    const owned = ownedCountsBySet[set.id] ?? 0;
    const total = set.total;
    const pct = total && total > 0 ? Math.min(100, Math.round((owned / total) * 100)) : null;
    const done = pct === 100;
    return (
      <li key={set.id}>
        <button
          type="button"
          className={styles.row}
          onClick={() => openSet(set.id, set.name)}
          aria-label={
            total ? `${set.name}, ${owned} of ${total} cards` : `${set.name}, ${owned} cards tracked`
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
              {total ? <span className={styles.count}>{total} cards</span> : null}
            </span>
          </span>
          {owned > 0 ? (
            <span className={styles.progress}>
              {/* Only when the set size is known. An empty bar reads as "0% done"
                  rather than "we do not know how big this set is". */}
              {pct !== null ? (
                <span className={`${styles.bar} ${done ? styles.barDone : ""}`}>
                  <span className={styles.fill} style={{ width: `${pct}%` }} />
                </span>
              ) : null}
              <span className={`${styles.pct} ${done ? styles.pctDone : ""}`}>
                {total ? `${owned}/${total}` : `${owned} held`}
              </span>
            </span>
          ) : null}
        </button>
      </li>
    );
  };

  return (
    <Screen title="Sets" headerLeft={<BackRow focused={false} onActivate={pop} />} canGoBack>
      {isLoading ? <LoadingState label="Loading sets…" /> : null}
      {isError ? (
        <ErrorState message="Couldn’t load sets" onRetry={() => void refetch()} retryFocused={false} />
      ) : null}
      {!isLoading && !isError && sets.started.length + sets.rest.length === 0 ? (
        <EmptyState title="No sets loaded" hint="Try again in a moment." />
      ) : null}

      {sets.started.length > 0 ? (
        <>
          <h2 className={styles.group}>In progress</h2>
          <ul className={styles.list}>{sets.started.map(row)}</ul>
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
