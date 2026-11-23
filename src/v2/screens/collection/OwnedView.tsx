import { useMemo, useState } from "react";
import { useNavigation } from "../../../app/NavigationProvider.tsx";
import { screenToPath } from "../../../app/screenUrl.ts";
import { useOwnedCards } from "../../../hooks/useOwnedCards.ts";
import { finishLabel } from "../../../models/finishes.ts";
import { csvFileName, ownedToCsv } from "../../../models/ownedCsv.ts";
import { formatChange } from "../../../utils/format.ts";
import {
  OWNED_SORTS_V2,
  sortOwned,
  totalOf,
  weekChange,
  type OwnedPrintingRow,
  type OwnedSortKey,
} from "../../../models/ownedSort.ts";
import { Card, CardArt, Chip, Money, Panel, Row, Stack, UNPRICED } from "../../primitives/index.ts";
import { EmptyStart } from "../home/EmptyStart.tsx";
import { Showcase } from "./Showcase.tsx";
import styles from "./collection.module.css";

const VIEWS = [
  { key: "showcase", label: "Showcase" },
  { key: "list", label: "List" },
] as const;

type ViewKey = (typeof VIEWS)[number]["key"];

/** Same file as v1's: BOM first so Excel reads it as UTF-8. */
function downloadCsv(rows: OwnedPrintingRow[]): void {
  const blob = new Blob(["﻿" + ownedToCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = csvFileName(new Date());
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Every printing held, as one sortable list — `#/owned`.
 *
 * A MODE of this screen rather than a screen of its own. The set list answers
 * "how far through each set am I"; this answers "what is the single most
 * valuable thing I own", which crosses sets and needs a sort control and a
 * price column. They are two questions about one collection, and v1 shipped
 * them as two menu entries that a collector had to remember the difference
 * between — the same mistake this spec exists to undo for Sets and Collection.
 *
 * Rows are printings, not cards: a card held in normal and reverse is two rows,
 * because they are two things with two prices and you own both.
 *
 * Two views over the SAME sorted rows. The showcase puts one card on screen at
 * a size worth looking at; the list is dense and scannable. The list is kept
 * rather than replaced because at 887 printings, scrubbing a filmstrip is a
 * poor way to find a particular card, and the sorts exist to be read down a
 * column.
 */
export function OwnedView() {
  const { push } = useNavigation();
  const { rows, pending, pricing } = useOwnedCards();
  const [sort, setSort] = useState<OwnedSortKey>("price");
  const [view, setView] = useState<ViewKey>("showcase");

  const sorted = useMemo(() => sortOwned(rows, sort), [rows, sort]);
  const { total, unpriced } = useMemo(() => totalOf(rows), [rows]);

  // The same empty state as Home and the set list (#165), with the same two ways in.
  if (rows.length === 0) return <EmptyStart headingLevel={2} />;

  return (
    <Panel
      title="Everything owned"
      headingLevel={2}
      aside={
        <span className={styles.caption} data-testid="owned-summary">
          {rows.length} printings
          {/*
            The total appears only once there is one. `formatUsd` renders a
            non-positive figure as "Unavailable", which is right for one card
            and wrong here: a running total of zero means nothing has priced
            yet, and saying so in the money slot reads as a failure rather than
            as progress.
          */}
          {total > 0 ? " · " : null}
          {total > 0 ? <Money value={total} /> : null}
          {/*
            Prices first: names arrive in one batch while the printings are
            still loading, and "unpriced" before pricing has finished counts
            cards that are merely not priced YET.
          */}
          {pricing > 0
            ? ` · still pricing ${pricing === 1 ? "1 set" : `${pricing} sets`}…`
            : pending > 0
              ? ` · loading ${pending === 1 ? "1 set" : `${pending} sets`}…`
              : unpriced > 0
                ? ` · ${unpriced} unpriced`
                : null}
        </span>
      }
    >
      <Stack gap={4}>
        {/*
          Rows of buttons rather than a <select>: there are two views and four
          sorts, they all fit, and the current one should be readable without
          opening anything.
        */}
        {/* gap 5 between the groups against gap 2 inside them, so "which chips
            belong together" is answered by the spacing and not by reading. */}
        <Row gap={5} wrap align="start">
          <div role="group" aria-label="View">
            <Row gap={2} wrap>
              {VIEWS.map((v) => (
                <Chip key={v.key} onPress={() => setView(v.key)} pressed={v.key === view}>
                  {v.label}
                </Chip>
              ))}
            </Row>
          </div>
          <div role="group" aria-label="Sort by">
            <Row gap={2} wrap>
              {OWNED_SORTS_V2.map((s) => (
                <Chip key={s.key} onPress={() => setSort(s.key)} pressed={s.key === sort}>
                  {s.label}
                </Chip>
              ))}
            </Row>
          </div>
          {/* Offered only once pricing has settled: a file written while sets
              are still pricing would list their cards as unpriced. */}
          {pricing === 0 && pending === 0 ? (
            <div role="group" aria-label="Export">
              <Row gap={2} wrap>
                <Chip onPress={() => downloadCsv(sorted)}>Download CSV</Chip>
              </Row>
            </div>
          ) : null}
        </Row>

        {view === "showcase" ? (
          <Showcase
            rows={sorted}
            showChange={sort === "change"}
            onOpen={(row) => push({ name: "details", cardId: row.cardId })}
          />
        ) : (
          <ul className={styles.ownedGrid}>
            {sorted.map((row) => (
              <li key={`${row.cardId}|${row.finish}`}>
                <Card
                  href={`#${screenToPath({ name: "details", cardId: row.cardId })}`}
                  onPress={() => push({ name: "details", cardId: row.cardId })}
                  pad={2}
                  label={`${row.name}, ${finishLabel(row.finish)}, ${row.setName} ${row.collectorNumber}`}
                >
                  <div className={styles.ownedRow}>
                    <span className={styles.ownedArt}>
                      <CardArt src={row.imageSmall} name={row.name} detail="tile" decorative />
                    </span>
                    <span className={styles.setHead}>
                      <span className={styles.setName}>{row.name}</span>
                      {/*
                        Finish first, set last. Two rows of the same card differ
                        only by finish, so it is the one field that must survive
                        the ellipsis on a narrow phone — with the set leading, a
                        pair of Charizards truncated to "Obsidian Flames · 125 ·
                        R…" and "… · N…", which is the only part that told them
                        apart.
                      */}
                      <span className={styles.setMeta}>
                        <span>{finishLabel(row.finish)}</span>
                        <span>
                          {row.setName} {row.collectorNumber}
                        </span>
                      </span>
                    </span>
                    {/*
                      No price is not a zero price: pattern foils are routinely
                      absent upstream, and "$0.00" would claim they are
                      worthless rather than unknown.
                    */}
                    <span className={styles.ownedPrice}>
                      <Money value={row.price} absentLabel={UNPRICED} />
                      {sort === "change" && weekChange(row) !== undefined ? (
                        <span className={styles.ownedChange} data-testid="owned-change">
                          {formatChange(weekChange(row) as number)}
                        </span>
                      ) : null}
                    </span>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Stack>
    </Panel>
  );
}
