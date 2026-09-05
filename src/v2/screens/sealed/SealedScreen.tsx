import { useEffect, useMemo, useState } from "react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { useLibrary } from "../../../app/LibraryProvider.tsx";
import { useNavigation } from "../../../app/NavigationProvider.tsx";
import { useSealed, type SealedRow } from "../../../hooks/useSealed.ts";
import { useSets } from "../../../hooks/useSets.ts";
import { SEALED_KINDS } from "../../../models/sealed.ts";
import { formatUpdated } from "../../../utils/format.ts";
import { Chip, cx, Money, Panel, Row, ScreenReaderOnly, Stack } from "../../primitives/index.ts";
import styles from "./sealed.module.css";

/**
 * What sealed product costs right now, for the sets you collect.
 *
 * Prices are TCGplayer market via tcgcsv — the same source and currency as
 * every card figure in the app — so a pack price and a card price can be
 * compared directly. Scoped to the sets you hold rather than all 217, because
 * "what does a box cost" is a question about what you are working on, and 217
 * sets would be 217 requests on a screen nobody scrolls to the bottom of.
 *
 * The rule this screen exists to keep: **an unpriced product is never $0.00.**
 * `Money` enforces it, and the two absences are told apart rather than merged —
 * a kind the set never sold reads "Not sold", a kind nobody has priced reads
 * "Unavailable". A single dash would say neither.
 *
 * No token of any kind is involved: `/api/sealed/:setId` is public catalog
 * data. What the screen needs is a COLLECTION, which is why its empty state
 * talks about marking cards and about the collection sync token.
 */
export function SealedScreen() {
  const { push } = useNavigation();
  const { collection } = useLibrary();
  const { rows } = useSealed();
  const sets = useSets();
  const queryClient = useQueryClient();

  /**
   * The sets being asked about, counted here rather than taken from
   * `useSealed`.
   *
   * `useSealed` returns `pending` and `missing`, and neither can be trusted to
   * arrive: its memo is keyed on `dataUpdatedAt`, which a FAILED query never
   * moves off zero. So a set whose request 404s (or whose server is down) is
   * counted as pending forever and the screen would sit on a skeleton it can
   * never leave — the "hanging request pins isLoading" failure this repo has
   * already shipped once. Reported to the shared layer; until it is fixed, the
   * counts here come from the collection and from React Query directly, which
   * both do update. `rows` is unaffected — a successful query does move
   * `dataUpdatedAt` — so no request is duplicated by this.
   */
  const setCount = useMemo(() => new Set(collection.map((c) => c.setId)).size, [collection]);
  const inFlight = useIsFetching({ queryKey: ["sealed"] });

  /**
   * Queries start on mount, not during render, so `inFlight` is legitimately 0
   * for one frame before anything is asked. Without this the "nothing came
   * back" state would flash on every visit, which is the same lie as a skeleton
   * that never ends, just faster.
   */
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (inFlight > 0) setStarted(true);
  }, [inFlight]);

  const collected = setCount > 0;
  const settled = started && inFlight === 0;
  const waiting = collected && !settled && !sets.isError;
  const unpriced = Math.max(0, setCount - rows.length);

  return (
    <Stack gap={5}>
      <header>
        <h1 className={styles.h1}>Sealed prices</h1>
        <p className={styles.lead}>{summary({ priced: rows.length, setCount, waiting, collected })}</p>
      </header>

      {!collected ? <NoCollection /> : null}

      {/* The set list is what maps a collected set id to the name the price
          source is looked up by. Without it there is nothing to ask for, and
          saying "no sealed products" would blame the wrong thing entirely. */}
      {collected && sets.isError && rows.length === 0 ? (
        <Problem
          title="The set list could not be read"
          body="Sealed prices are looked up by set name, so the catalog has to answer before any price can be asked for. Nothing is wrong with your collection."
          onRetry={() => void sets.refetch()}
        />
      ) : null}

      {waiting && rows.length === 0 ? <Loading count={setCount} /> : null}

      {settled && collected && rows.length === 0 && !sets.isError ? (
        <Problem
          title="No sealed prices right now"
          body={`None of your ${setCount} ${setCount === 1 ? "set" : "sets"} came back with a sealed product. Promos, tins and subsets are never sold in packs, so for those this is the right answer — but a price source that cannot be reached looks the same from here.`}
          onRetry={() => void queryClient.invalidateQueries({ queryKey: ["sealed"] })}
        />
      ) : null}

      {rows.map((row) => (
        <SetPrices
          key={row.setId}
          row={row}
          onOpen={() => push({ name: "set", setId: row.setId, setName: row.setName })}
        />
      ))}

      {/*
        Said once, at the bottom, and only when some sets DID price. Promos and
        tins genuinely have no sealed product; a set the source could not be
        reached for lands in the same count, because nothing on this side can
        tell those two apart.
      */}
      {rows.length > 0 && !waiting && unpriced > 0 ? (
        <p className={styles.meta}>
          {unpriced} of your sets {unpriced === 1 ? "has" : "have"} no sealed product listed. Promos and tins
          are not sold in packs; a set the price source could not be reached for also counts here.
        </p>
      ) : null}
    </Stack>
  );
}

/**
 * The honest headline: what is priced against what was asked for, with anything
 * still in flight named rather than folded into the total. "12 sets" over a
 * screen showing four is the shape of lie this avoids.
 */
function summary({
  priced,
  setCount,
  waiting,
  collected,
}: {
  priced: number;
  setCount: number;
  waiting: boolean;
  collected: boolean;
}): string {
  if (!collected) return "Nothing is collected on this device yet.";
  if (waiting && priced === 0) return `Pricing ${setCount} ${setCount === 1 ? "set" : "sets"}…`;
  const line = `${priced} of ${setCount} ${setCount === 1 ? "set" : "sets"} priced`;
  return waiting ? `${line} · still loading` : line;
}

/**
 * One set, four figures.
 *
 * A `Panel` per set rather than a grid of tiles: the four kinds are one row on
 * a laptop and a wrapped block on a phone, and `Grid` cannot be asked for a
 * column wider than a card — its `min` takes a pocket size, which is the right
 * constraint for grids OF cards and the wrong one for a row of prices.
 */
function SetPrices({ row, onOpen }: { row: SealedRow; onOpen: () => void }) {
  const byKind = new Map(row.prices.map((p) => [p.kind, p]));

  return (
    <Panel
      title={row.setName}
      aside={
        <Chip onPress={onOpen} label={`Open ${row.setName}`}>
          Open set
        </Chip>
      }
    >
      <Stack gap={3}>
        <p className={styles.meta}>
          {row.holdings} printing{row.holdings === 1 ? "" : "s"} held
          {/* The separator rides INSIDE the volatile span, which the snapshot
              run hides — a dangling "·" in a baseline reads as a bug. */}
          <span data-snapshot="volatile"> · priced {formatUpdated(row.updated)}</span>
        </p>
        <Row gap={4} wrap align="start">
          {SEALED_KINDS.map((kind) => {
            const found = byKind.get(kind.key);
            return (
              <Stack key={kind.key} gap={1} className={styles.cell}>
                <span className={styles.kind}>{kind.label}</span>
                {/*
                  Two different absences, kept different. "Not sold" is a fact
                  about the set — no ETB was ever printed for it. Money's own
                  "Unavailable" is a fact about the price — the product exists
                  and nobody has a figure for it. Neither is $0.00, which is a
                  third thing entirely and would be a lie about both.
                */}
                {found === undefined ? (
                  <Money value={undefined} absentLabel="Not sold" />
                ) : (
                  <Money value={found.price} />
                )}
              </Stack>
            );
          })}
        </Row>
      </Stack>
    </Panel>
  );
}

/**
 * No collection on this device.
 *
 * The screen is empty for a reason that has an action attached, so it says the
 * action. This is also the "no token" state: sealed prices need none of their
 * own, but the collection they follow arrives either by marking cards here or
 * by connecting this device with the collection sync token.
 */
function NoCollection() {
  return (
    <Panel title="Nothing collected yet" tone="raised">
      <Stack gap={3}>
        <p>
          Sealed prices follow the sets you collect, so there is nothing to price until this device holds some
          cards. Mark a card as owned — or connect this device to your collection with the sync token — and
          its set&rsquo;s pack, box, bundle and ETB prices appear here.
        </p>
        <p className={styles.meta}>
          These prices need no token of their own: they are public catalog data, read from TCGplayer&rsquo;s
          daily dump.
        </p>
      </Stack>
    </Panel>
  );
}

function Loading({ count }: { count: number }) {
  return (
    <Stack gap={4} aria-busy="true">
      <ScreenReaderOnly>{`Pricing ${count} sets`}</ScreenReaderOnly>
      <div className={cx(styles.bar, styles.barTall)} />
      <div className={styles.bar} />
      <div className={styles.bar} />
    </Stack>
  );
}

/** A state that says what could not be read, and offers the retry for it. */
function Problem({ title, body, onRetry }: { title: string; body: string; onRetry: () => void }) {
  return (
    <Panel title={title} tone="raised">
      <Stack gap={3}>
        <p>{body}</p>
        <Row gap={2}>
          <Chip onPress={onRetry}>Try again</Chip>
        </Row>
      </Stack>
    </Panel>
  );
}
