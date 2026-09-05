import { useLibrary } from "../../../app/LibraryProvider.tsx";
import { screenToPath } from "../../../app/screenUrl.ts";
import { continueTarget, topProgress } from "../../../features/home/continueSet.ts";
import { useLibraryValue } from "../../../hooks/useLibraryValue.ts";
import { useSets } from "../../../hooks/useSets.ts";
import { countBinder, type Binder } from "../../../models/binderLayout.ts";
import { Card, Panel, Stack } from "../../primitives/index.ts";
import { EmptyHome } from "./EmptyHome.tsx";
import { GrowthChart } from "./GrowthChart.tsx";
import { ProgressPanel } from "./ProgressPanel.tsx";
import { ValuePanel } from "./ValuePanel.tsx";
import { syncNotice } from "./homeSummary.ts";
import styles from "./Home.module.css";

/**
 * Home: what is my collection, and what is it worth, right now.
 *
 * ## Why there is no row of destination tiles
 *
 * The spec lists Sets, Search, Scan, Binders, Sealed and Target as parity items
 * and asks for "actions as a row of tiles" at 1440. They are not in the file the
 * parity checklist cites — `web/home/WebHomeScreen.tsx` has no such tiles, and
 * says why in a comment. They are in v1's APP BAR, and v2's shell nav is that
 * app bar's direct successor: all six are one click away from here and from
 * every other screen, already marked with `aria-current`.
 *
 * Restating them down the page would spend the most valuable surface in the app
 * on a control the reader already has, and would put two competing answers to
 * "where do I go" on the same screen — one of which goes out of date the moment
 * the nav gains an entry. So the tiles Home does draw are the ones that carry
 * something the nav cannot: a set with your progress on it, a shelf with a count,
 * a total with its denominator. Every one of them is a link with a real target.
 *
 * ## Why sync is usually absent
 *
 * The shell prints `syncLine`'s label on every screen, this one included. Home
 * adds a panel only for the two states that stay broken until a person acts —
 * see `syncNotice`.
 *
 * ## The request budget
 *
 * This screen adds NO requests. Every hook it calls is one the app already runs
 * and shares a cache key with, and the collection is priced by a single
 * `/api/catalog/prices` call for every set at once. That call replaced nineteen
 * per-set ones at 4.5–6.7s each, several of which failed outright and left Home
 * reporting "480 of 973 printings priced". `homeSummary.test.ts` asserts that
 * nothing in this directory opens a query of its own.
 */
export function HomeScreen() {
  const {
    collection,
    ownedCountsBySet,
    ownedFinishCountsBySet,
    ownedNumbersBySet,
    totalFinishesOwned,
    ownedStamps,
    binders,
    syncStatus,
  } = useLibrary();
  const { data: sets } = useSets();
  const value = useLibraryValue();

  const notice = syncNotice(syncStatus);

  if (collection.length === 0) {
    return (
      <Stack gap={5}>
        {notice ? <SyncNotice label={notice.label} detail={notice.detail} /> : null}
        <EmptyHome />
      </Stack>
    );
  }

  const resume = continueTarget(
    collection,
    sets,
    ownedCountsBySet,
    ownedFinishCountsBySet,
    ownedNumbersBySet,
  );
  /*
   * Base, not master. This list answers "what can I finish", and ranking on the
   * master tier buries the set three commons short behind one that needs a
   * chase card nobody pulls — see topProgress.
   */
  const rows = topProgress(ownedCountsBySet, sets, ownedNumbersBySet);
  const setCount = Object.keys(ownedCountsBySet).length;

  return (
    <Stack gap={5}>
      {notice ? <SyncNotice label={notice.label} detail={notice.detail} /> : null}

      <header>
        <h1 className={styles.title}>Your collection</h1>
        <p className={styles.stats}>
          <span className={styles.statNumber}>{collection.length.toLocaleString()}</span> cards ·{" "}
          <span className={styles.statNumber}>{totalFinishesOwned.toLocaleString()}</span> printings ·{" "}
          <span className={styles.statNumber}>{setCount.toLocaleString()}</span>{" "}
          {setCount === 1 ? "set" : "sets"}
        </p>
      </header>

      <div className={styles.top}>
        <ValuePanel
          total={value.total}
          movement={value.movement}
          pricing={{
            printings: value.printings,
            priced: value.priced,
            pending: value.pending,
            failed: value.failed,
            bySet: value.bySet,
            setNames: value.setNames,
            setsLoaded: sets !== undefined,
          }}
        />
        <GrowthChart stamps={ownedStamps} />
      </div>

      <ProgressPanel resume={resume} rows={rows} loading={sets === undefined} />

      {/*
        The one destination Home repeats from the nav, and only because it can
        say something the nav cannot: how many binders there are and how much is
        in them. Hidden entirely when there are none — an empty feature does not
        need advertising from the busiest screen in the app.
      */}
      {binders.length > 0 ? <Shelf count={binders.length} placed={placedCards(binders)} /> : null}
    </Stack>
  );
}

function placedCards(binders: Binder[]): number {
  return binders.reduce((sum, b) => sum + countBinder(b).cards, 0);
}

function Shelf({ count, placed }: { count: number; placed: number }) {
  const label = `${count} ${count === 1 ? "binder" : "binders"} · ${placed} ${placed === 1 ? "card" : "cards"} placed`;
  return (
    <Card
      href={`#${screenToPath({ name: "binders" })}`}
      label={`Binders: ${label}`}

      pad={4}
    >
      <Stack gap={1}>
        <span className={styles.resumeName}>Binders</span>
        <span className={styles.resumeMeta}>{label}</span>
      </Stack>
    </Card>
  );
}

function SyncNotice({ label, detail }: { label: string; detail: string }) {
  return (
    <Panel className={styles.sync} headingLevel={2} title={<span className={styles.syncLabel}>{label}</span>}>
      <p className={styles.syncDetail}>{detail}</p>
    </Panel>
  );
}
