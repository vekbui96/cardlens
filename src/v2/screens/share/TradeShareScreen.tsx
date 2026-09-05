import { useMemo, useState } from "react";
import { useShare } from "./useShare.ts";
import { ShareGone, ShareHeader, ShareLoading } from "./ShareFrame.tsx";
import { BinderSpread } from "../binder/index.ts";
import { useBinderValue } from "../../../hooks/useBinderValue.ts";
import { countBinder, pageGroups, conditionLabel } from "../../../models/binderLayout.ts";
import { pocketAddress } from "../../../models/binderPocket.ts";
import { tradeRows, type TradeRow } from "../../../models/tradeShare.ts";
import { finishLabel } from "../../../models/finishes.ts";
import { CardArt, Chip, Money, Panel, Row, Stack, cx } from "../../primitives/index.ts";
import styles from "./share.module.css";

/**
 * Somebody's binder, offered.
 *
 * A trade share is not a showcase with a price column. A showcase says what its
 * owner HAS; this says what they will GIVE UP, which is a different question
 * with a different answer, and the two are separate pages for that reason.
 *
 * Two views of one binder, and each is for something. The spread is the MAP —
 * it is how the owner sees it, so "the Umbreon on page two" means the same
 * thing to both of you. The list is the DECISION — sorted by value, priced per
 * copy. They are bound by the POCKET ADDRESS, because the next thing that
 * happens after finding a card is asking for it by name.
 *
 * No ownership is drawn. What the owner also keeps is their business, exactly
 * as excluded printings are on a shared set.
 */

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
  const value = useBinderValue(binder);
  const [sort, setSort] = useState<SortKey>("value");
  const [lit, setLit] = useState<string | null>(null);

  const rows = useMemo(() => (binder ? tradeRows(binder) : []), [binder]);

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

  if (query.isLoading) return <ShareLoading what="this binder" />;
  if (query.isError || !binder) return <ShareGone onRetry={() => void query.refetch()} />;

  const counts = countBinder(binder);
  const groups = pageGroups(binder.pages.length, binder.format);

  /** Light the pocket a row names, and bring it into view. */
  function jumpTo(row: TradeRow) {
    const key = `${row.page - 1}:${row.pocket - 1}`;
    setLit(key);
    document.querySelector(`[data-pocket="${key}"]`)?.scrollIntoView({ block: "center" });
  }

  return (
    <Stack gap={5}>
      <ShareHeader
        title={binder.name}
        subtitle={
          <>
            Offered for trade · <strong>{counts.cards}</strong> {counts.cards === 1 ? "card" : "cards"}
          </>
        }
        updatedAt={share?.at}
        aside={
          <span className={styles.total}>
            <Money value={value.total} loading={value.isLoading} />
            {value.unpriced > 0 ? <span className={styles.unpriced}>{value.unpriced} unpriced</span> : null}
          </span>
        }
      />

      <Panel title="What's on offer" headingLevel={2}>
        <Stack gap={3}>
          <Row gap={2} wrap>
            {SORTS.map((s) => (
              <Chip key={s.key} onPress={() => setSort(s.key)} pressed={sort === s.key}>
                {s.label}
              </Chip>
            ))}
          </Row>

          <ul className={styles.tradeList} aria-label="Cards on offer">
            {sorted.map((row) => {
              const key = `${row.page - 1}:${row.pocket - 1}`;
              return (
                <li key={`${row.slot.cardId}|${row.slot.finish}|${key}`}>
                  <button
                    type="button"
                    className={cx(styles.tradeRow, lit === key && styles.tradeRowLit)}
                    onClick={() => jumpTo(row)}
                  >
                    <span className={styles.tradeArt} aria-hidden="true">
                      <CardArt
                        src={row.slot.imageSmall}
                        name={row.slot.name ?? ""}
                        detail="tile"
                        decorative
                      />
                    </span>
                    <span className={styles.tradeName}>{row.slot.name ?? "Card"}</span>
                    <span className={styles.tradeMeta}>
                      {/* The address, which is how the two of you will name it. */}
                      {pocketAddress(row.page, row.pocket - 1)} · {finishLabel(row.slot.finish)}
                      {row.copies > 1 ? ` · ${row.copies} copies` : ""}
                      {row.slot.condition ? ` · ${conditionLabel(row.slot.condition)}` : ""}
                    </span>
                    <span className={styles.tradePrice}>
                      <Money value={value.priceFor(row.slot)} loading={value.isLoading} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {sorted.length === 0 ? <p>This binder is empty.</p> : null}
        </Stack>
      </Panel>

      <Panel title="As it is laid out" headingLevel={2}>
        <Stack gap={4}>
          {groups.map((pages, i) => (
            <BinderSpread
              key={pages.join("-")}
              binder={binder}
              pages={pages}
              owns={NOTHING_TO_FLAG}
              priceFor={value.priceFor}
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
