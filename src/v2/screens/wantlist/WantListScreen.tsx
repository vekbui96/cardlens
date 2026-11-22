import { useCallback, useEffect, useMemo, useState } from "react";
import { useLibrary } from "../../../app/LibraryProvider.tsx";
import { useSets } from "../../../hooks/useSets.ts";
import { printingsCache } from "../../../storage/caches.ts";
import { Chip, Panel, Stack } from "../../primitives/index.ts";
import { SetSkeleton, WantSetSection, type SectionKind } from "./WantSetSection.tsx";
import {
  WANT_SORT_LABELS,
  applyWantFilters,
  isFiltering,
  readWantFilters,
  storeWantFilters,
  wantFilteredHeadline,
  wantRarities,
  type WantFilters,
  type WantSort,
} from "./wantFilters.ts";
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

  const [stored, setStored] = useState(readWantFilters);
  const update = useCallback((next: WantFilters) => {
    setStored(next);
    storeWantFilters(next);
  }, []);
  // A remembered set that is no longer started is not a filter: it would hide everything.
  const filters = useMemo<WantFilters>(
    () =>
      stored.setId !== null && started.length > 0 && !started.some((s) => s.setId === stored.setId)
        ? { ...stored, setId: null }
        : stored,
    [stored, started],
  );
  const filtering = isFiltering(filters);

  const readyWants = started.map((s) => states[s.setId]?.want);
  const rarities = useMemo(() => {
    const inScope = started
      .filter((s) => filters.setId === null || s.setId === filters.setId)
      .map((s) => states[s.setId]?.want);
    const present = wantRarities(inScope);
    return [...present, ...filters.rarities.filter((r) => !present.includes(r))];
  }, [started, states, filters.setId, filters.rarities]);

  const totals = sumWant(readyWants);
  const shownTotals = sumWant(
    started.map((s) => {
      const want = states[s.setId]?.want;
      return want && (filters.setId === null || filters.setId === s.setId)
        ? applyWantFilters(want, filters)
        : null;
    }),
  );
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
              {settled === 0
                ? "Counting what is missing…"
                : filtering
                  ? wantFilteredHeadline(shownTotals)
                  : wantHeadline(totals)}
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

      {started.length > 0 ? (
        <Stack gap={3}>
          <label className={styles.control}>
            <span className={styles.controlLabel}>Set</span>
            <select
              className={styles.select}
              value={filters.setId ?? ""}
              onChange={(e) => update({ ...filters, setId: e.target.value || null })}
            >
              <option value="">All sets</option>
              {started.map((s) => (
                <option key={s.setId} value={s.setId}>
                  {s.setName}
                </option>
              ))}
            </select>
          </label>
          {rarities.length > 0 ? (
            <div role="group" aria-label="Rarity" className={styles.chips}>
              {rarities.map((rarity) => {
                const on = filters.rarities.includes(rarity);
                return (
                  <Chip
                    key={rarity}
                    tone={on ? "accent" : "default"}
                    pressed={on}
                    onPress={() =>
                      update({
                        ...filters,
                        rarities: on
                          ? filters.rarities.filter((r) => r !== rarity)
                          : [...filters.rarities, rarity],
                      })
                    }
                  >
                    {rarity}
                  </Chip>
                );
              })}
            </div>
          ) : null}
          <div role="group" aria-label="Sort" className={styles.chips}>
            {(Object.keys(WANT_SORT_LABELS) as WantSort[]).map((sort) => (
              <Chip
                key={sort}
                tone={filters.sort === sort ? "accent" : "default"}
                pressed={filters.sort === sort}
                onPress={() => update({ ...filters, sort })}
              >
                {WANT_SORT_LABELS[sort]}
              </Chip>
            ))}
            {filtering ? (
              <Chip onPress={() => update({ ...filters, setId: null, rarities: [] })}>Clear filters</Chip>
            ) : null}
          </div>
        </Stack>
      ) : null}

      {sets === undefined ? <SetSkeleton setName="Sets" /> : null}

      {started.map((set) =>
        allowed.has(set.setId) ? (
          <WantSetSection
            key={set.setId}
            setId={set.setId}
            setName={set.setName}
            ownedNumbers={set.ownedNumbers}
            filters={filters}
            onState={onState}
          />
        ) : filters.setId === null || filters.setId === set.setId ? (
          <SetSkeleton key={set.setId} setName={set.setName} />
        ) : null,
      )}

      {loading === 0 && failed === 0 && filtering && totals.missing > 0 && shownTotals.missing === 0 ? (
        <Panel title="Nothing matches" headingLevel={2}>
          <p className={styles.meta}>No missing card matches these filters. Clear them to see everything.</p>
        </Panel>
      ) : null}

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
