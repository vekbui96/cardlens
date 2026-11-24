import { useEffect, useMemo, useRef, useState } from "react";
import { useShare } from "./useShare.ts";
import { ShareGone, ShareHeader, ShareLoading, ShareOffline, isOffline } from "./ShareFrame.tsx";
// The file, not the barrel: the barrel carries BinderScreen, which renders this
// page's view in its Share preview, and the barrel would make that a cycle.
import { BinderSpread } from "../binder/BinderSpread.tsx";
import { useBinderValue } from "../../../hooks/useBinderValue.ts";
import { countBinder, pageGroups, conditionLabel, type Binder } from "../../../models/binderLayout.ts";
import { pocketAddress } from "../../../models/binderPocket.ts";
import { tradeRows, type TradeRow } from "../../../models/tradeShare.ts";
import { finishLabel } from "../../../models/finishes.ts";
import { CardArt, Chip, Money, Panel, Row, Sheet, Stack, UNPRICED } from "../../primitives/index.ts";
import styles from "./share.module.css";

/**
 * Somebody's binder, shown off: the page a visitor lands on from a binder link.
 *
 * Card first. A visitor came to LOOK at the cards, so the page leads with them
 * large, two to a row on a phone, and a tap opens one bigger still. Prices ride
 * along per copy, and a card nothing prices says "Unpriced" rather than a zero:
 * "we do not know" is not "worthless".
 *
 * Two views of one binder, and each is for something. The grid is the
 * SHOWCASE, sortable by value. The spread is the MAP — it is how the owner sees
 * it, so "the Umbreon on page two" means the same thing to both of you. They
 * are bound by the POCKET ADDRESS, because the next thing that happens after
 * finding a card is asking for it by name. A trade binder says so in its
 * header; the page is the same either way.
 *
 * No ownership is drawn. What the owner also keeps is their business, exactly
 * as excluded printings are on a shared set.
 */

/** One stable key per pocket: a card can sit in two pockets of one binder. */
function rowKey(row: TradeRow): string {
  return `${row.slot.cardId}|${row.slot.finish}|${row.page - 1}:${row.pocket - 1}`;
}

/** Address, finish, then the stock facts that are not the default. */
function rowMeta(row: TradeRow): string {
  return [
    `${pocketAddress(row.page, row.pocket - 1)} · ${finishLabel(row.slot.finish)}`,
    row.copies > 1 ? `${row.copies} copies` : "",
    row.slot.condition ? conditionLabel(row.slot.condition) : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

type SortKey = "value" | "pocket" | "name";

const SORTS: { key: SortKey; label: string }[] = [
  // Value first and by default: a visitor is scanning for the best thing here,
  // not reading the binder front to back.
  { key: "value", label: "Value" },
  { key: "pocket", label: "Pocket" },
  { key: "name", label: "Name" },
];

/**
 * No ownership is drawn on a trade page, and this is how you say that to
 * `BinderSpread`.
 *
 * It looks backwards, so: `owns` decides whether a pocket gets the "Don't own"
 * tag, and that tag exists for the BUILDER, where an unowned card is a card you
 * are planning to get. Here every card is one the owner is holding in their
 * hand and offering, so returning false tagged all of them "Don't own" — the
 * page telling a visitor that the person offering these cards does not have
 * them. Returning true means "nothing to flag", which is the truth.
 *
 * Whether the owner ALSO keeps a second copy is their business, exactly as
 * excluded printings are on a shared set.
 */
const NOTHING_TO_FLAG = () => true;

export function TradeShareScreen({ shareId }: { shareId: string }) {
  const query = useShare(shareId);
  const share = query.data?.kind === "binder" ? query.data : null;
  const binder = share?.binder ?? null;

  if (query.isLoading) return <ShareLoading what="this binder" />;
  if (query.isError && isOffline()) return <ShareOffline onRetry={() => void query.refetch()} />;
  if (query.isError || !binder) return <ShareGone onRetry={() => void query.refetch()} />;

  return <BinderShowcaseView binder={binder} updatedAt={share?.at} />;
}

/**
 * The visitor's page for one binder, drawn from the binder itself.
 *
 * Split from the screen so the owner's Share preview (`SharePreview` on the v2
 * Binder screen) renders exactly this — "what a visitor sees" is only true if
 * it is the same component, not a lookalike that drifts.
 */
export function BinderShowcaseView({ binder, updatedAt }: { binder: Binder; updatedAt?: number }) {
  const value = useBinderValue(binder);
  const [sort, setSort] = useState<SortKey>("value");
  /** The pocket whose card is open large, by `rowKey`. */
  const [open, setOpen] = useState<string | null>(null);
  /** Each tile's button by `rowKey`, so closing can hand focus back to it. */
  const tiles = useRef(new Map<string, HTMLButtonElement>());
  const lastOpened = useRef<string | null>(null);

  /**
   * Closing the large card puts focus back on the tile that opened it.
   *
   * `Sheet` returns focus to whatever was focused before it opened, but iPhone
   * Safari does not focus a button on tap, so that was the page itself and a
   * visitor lost their place in the grid. Runs after `Sheet`'s own cleanup
   * (React runs every effect cleanup before any new effect), so it wins.
   */
  useEffect(() => {
    if (open !== null) {
      lastOpened.current = open;
      return;
    }
    const key = lastOpened.current;
    lastOpened.current = null;
    if (key) tiles.current.get(key)?.focus();
  }, [open]);

  const rows = useMemo(() => tradeRows(binder), [binder]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    if (sort === "name") return copy.sort((a, b) => (a.slot.name ?? "").localeCompare(b.slot.name ?? ""));
    if (sort === "pocket") return copy.sort((a, b) => a.page - b.page || a.pocket - b.pocket);
    return copy.sort((a, b) => {
      // Unpriced sinks rather than sorting as zero: "we do not know" is not
      // "worthless", and burying a chase card because nothing priced it is the
      // one mistake this list cannot afford.
      const av = value.lineTotalFor(a.slot);
      const bv = value.lineTotalFor(b.slot);
      if (av === undefined && bv === undefined) return a.page - b.page || a.pocket - b.pocket;
      if (av === undefined) return 1;
      if (bv === undefined) return -1;
      return bv - av;
    });
  }, [rows, sort, value]);

  const counts = countBinder(binder);
  const groups = pageGroups(binder.pages.length, binder.format);
  const enlarged = sorted.find((row) => rowKey(row) === open) ?? null;

  return (
    <Stack gap={5}>
      <ShareHeader
        title={binder.name}
        subtitle={
          <>
            {binder.forTrade ? "Offered for trade" : "A shared binder"} · <strong>{counts.copies}</strong>{" "}
            {counts.copies === 1 ? "card" : "cards"}
            {value.unpriced > 0 ? (
              <>
                {" · "}
                <span className={styles.unpriced}>{value.unpriced} unpriced</span>
              </>
            ) : null}
          </>
        }
        updatedAt={updatedAt}
        aside={
          <span className={styles.total}>
            <span className={styles.totalLabel}>Total value</span>
            <Money value={value.total} loading={value.isLoading} absentLabel={UNPRICED} />
          </span>
        }
      />

      {sorted.length === 0 ? (
        <Panel title="Nothing here yet" headingLevel={2}>
          <p className={styles.emptyText}>
            This binder has no cards in it yet. Ask whoever sent the link to add some and share it again; this
            same link will show them.
          </p>
        </Panel>
      ) : (
        <Panel title="The cards" headingLevel={2}>
          <Stack gap={3}>
            <Row gap={2} wrap justify="space-between">
              <p className={styles.hint}>Tap a card to see it larger</p>
              <div role="group" aria-label="Sort cards" className={styles.sortPills}>
                <span className={styles.sortLabel} aria-hidden="true">
                  Sort by
                </span>
                {SORTS.map((s) => (
                  <Chip key={s.key} onPress={() => setSort(s.key)} pressed={sort === s.key}>
                    {s.label}
                  </Chip>
                ))}
              </div>
            </Row>

            <ul className={styles.showcaseGrid} aria-label="Cards in this binder">
              {sorted.map((row, i) => (
                <li key={rowKey(row)}>
                  <button
                    type="button"
                    className={styles.showcaseCard}
                    onClick={() => setOpen(rowKey(row))}
                    ref={(el) => {
                      if (el) tiles.current.set(rowKey(row), el);
                      else tiles.current.delete(rowKey(row));
                    }}
                  >
                    <CardArt
                      src={row.slot.imageSmall}
                      name={row.slot.name ?? ""}
                      detail="pocket"
                      decorative
                      eager={i < 4}
                    />
                    <span className={styles.showcaseName}>{row.slot.name ?? "Card"}</span>
                    {/* The address, which is how the two of you will name it. */}
                    <span className={styles.showcaseMeta}>{rowMeta(row)}</span>
                    <span className={styles.showcasePrice}>
                      <Money
                        value={value.priceFor(row.slot)}
                        loading={value.isLoading}
                        absentLabel={UNPRICED}
                      />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Stack>
        </Panel>
      )}

      <Sheet open={enlarged !== null} onClose={() => setOpen(null)} label={enlarged?.slot.name ?? "Card"}>
        {enlarged ? (
          <div className={styles.enlarged}>
            <div className={styles.enlargedArt} data-fit="whole-card">
              <CardArt
                src={enlarged.slot.imageSmall}
                name={enlarged.slot.name ?? "Card"}
                detail="hero"
                eager
              />
            </div>
            <h2 className={styles.enlargedName}>{enlarged.slot.name ?? "Card"}</h2>
            <p className={styles.enlargedMeta}>
              Page {enlarged.page}, pocket {enlarged.pocket} · {finishLabel(enlarged.slot.finish)}
              {enlarged.copies > 1 ? ` · ${enlarged.copies} copies` : ""}
              {enlarged.slot.condition ? (
                <>
                  {" · "}
                  <span className={styles.noWrap} data-nowrap>
                    {conditionLabel(enlarged.slot.condition)}
                  </span>
                </>
              ) : null}
            </p>
            <span
              className={styles.enlargedPrice}
              data-absent={value.isLoading || typeof value.priceFor(enlarged.slot) !== "number"}
            >
              <Money value={value.priceFor(enlarged.slot)} loading={value.isLoading} absentLabel={UNPRICED} />
            </span>
            <button type="button" className={styles.closeButton} onClick={() => setOpen(null)}>
              Back to the cards
            </button>
          </div>
        ) : null}
      </Sheet>

      <Panel title="As it is laid out" headingLevel={2}>
        <Stack gap={4}>
          {groups.map((pages, i) => (
            <BinderSpread
              key={pages.join("-")}
              binder={binder}
              pages={pages}
              owns={NOTHING_TO_FLAG}
              priceFor={value.priceFor}
              absentLabel={UNPRICED}
              headingLevel={3}
              eager={i === 0}
              selected={null}
            />
          ))}
        </Stack>
      </Panel>
    </Stack>
  );
}
