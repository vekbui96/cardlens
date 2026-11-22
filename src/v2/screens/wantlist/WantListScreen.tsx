import { useCallback, useEffect, useMemo, useState } from "react";
import { useLibrary } from "../../../app/LibraryProvider.tsx";
import { useSets } from "../../../hooks/useSets.ts";
import { printingsCache } from "../../../storage/caches.ts";
import { Panel, Stack } from "../../primitives/index.ts";
import { SetSkeleton, WantSetSection, type SectionKind } from "./WantSetSection.tsx";
import { sumWant, wantHeadline, type WantSet } from "./wantList.ts";
import styles from "./wantlist.module.css";

/** Sets fetched at once. Cached ones go first and settle at once, so this caps network work only. */
const CONCURRENT = 3;

interface StartedSet {
  setId: string;
  setName: string;
  ownedNumbers: readonly string[] | null;
}

interface SectionState {
  kind: SectionKind;
  want: WantSet | null;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * The Want list: every card missing from the sets you have started, grouped by
 * set, with what finishing would cost.
 *
 * Only sets with at least one owned card are fetched, each through the Set
 * screen's own data path (one request a set, cached printings first), and at
 * most `CONCURRENT` uncached sets at a time, cached ones first, so opening this
 * never fans out across the whole catalog at once. Each set loads, fails and
 * retries on its own; the header adds up what has arrived and says how many
 * sets are still on the way, so a partial total never passes for a full one.
 */
export function WantListScreen() {
  const { ownedCountsBySet, ownedNumbersBySet } = useLibrary();
  const { data: sets } = useSets();

  const started = useMemo<StartedSet[]>(() => {
    if (!sets) return [];
    return sets
      .filter((set) => (ownedCountsBySet[set.id] ?? 0) > 0)
      .map((set) => {
        const owned = ownedNumbersBySet[set.id];
        return {
          setId: set.id,
          setName: set.name,
          // Home's rule: numbers that do not add up to the cards held are not used.
          ownedNumbers: owned && owned.length === ownedCountsBySet[set.id] ? owned : null,
        };
      });
  }, [sets, ownedCountsBySet, ownedNumbersBySet]);

  // Cached printings first: they paint at once and cost nothing.
  const startOrder = useMemo(
    () =>
      [...started].sort(
        (a, b) => Number(!printingsCache.get(a.setId)) - Number(!printingsCache.get(b.setId)),
      ),
    [started],
  );

  const [states, setStates] = useState<Record<string, SectionState>>({});
  const onState = useCallback((setId: string, kind: SectionKind, want: WantSet | null) => {
    setStates((prev) =>
      prev[setId]?.kind === kind && prev[setId]?.want === want ? prev : { ...prev, [setId]: { kind, want } },
    );
  }, []);

  const settled = started.filter((s) => states[s.setId] && states[s.setId].kind !== "loading").length;
  // Only ever grows, so a retry going back to "loading" never unmounts a later set.
  const [reach, setReach] = useState(CONCURRENT);
  useEffect(() => setReach((r) => Math.max(r, settled + CONCURRENT)), [settled]);
  const allowed = useMemo(() => new Set(startOrder.slice(0, reach).map((s) => s.setId)), [startOrder, reach]);

  const totals = sumWant(started.map((s) => states[s.setId]?.want));
  const loading = sets === undefined ? null : started.length - settled;
  const failed = started.filter((s) => states[s.setId]?.kind === "error").length;
  const knownSets = Object.keys(ownedCountsBySet).filter((id) => (ownedCountsBySet[id] ?? 0) > 0).length;

  return (
    <Stack gap={5}>
      <header>
        <h1 className={styles.title}>Want list</h1>
        {loading === null ? (
          <p className={styles.meta}>Loading your sets…</p>
        ) : started.length === 0 ? (
          <p className={styles.meta}>
            {knownSets === 0
              ? "Nothing collected yet. Mark a card in any set and the rest of that set shows up here."
              : "None of the sets you collect are in the catalog yet."}
          </p>
        ) : (
          <Stack gap={1}>
            <p className={styles.headline} data-testid="want-headline">
              {settled === 0 ? "Counting what is missing…" : wantHeadline(totals)}
            </p>
            {loading > 0 || failed > 0 ? (
              <p className={styles.meta}>
                {[
                  loading > 0 ? `${plural(loading, "set", "sets")} still loading` : null,
                  failed > 0 ? `${plural(failed, "set", "sets")} could not be loaded` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
          </Stack>
        )}
      </header>

      {sets === undefined ? <SetSkeleton setName="Sets" /> : null}

      {started.map((set) =>
        allowed.has(set.setId) ? (
          <WantSetSection
            key={set.setId}
            setId={set.setId}
            setName={set.setName}
            ownedNumbers={set.ownedNumbers}
            onState={onState}
          />
        ) : (
          <SetSkeleton key={set.setId} setName={set.setName} />
        ),
      )}

      {loading === 0 && started.length > 0 && totals.missing === 0 && failed === 0 ? (
        <Panel title="Nothing missing" headingLevel={2}>
          <p className={styles.meta}>
            Every set you have started is complete, as far as its printings are known.
          </p>
        </Panel>
      ) : null}
    </Stack>
  );
}
