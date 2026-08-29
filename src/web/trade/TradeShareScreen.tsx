import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { Screen } from "../../components/Screen.tsx";
import { CardImage } from "../../components/CardImage.tsx";
import { LoadingState, ErrorState } from "../../components/States.tsx";
import { BinderPageView } from "../../components/BinderPage.tsx";
import { pocketAddress } from "../../models/binderPocket.ts";
import { useBinderValue } from "../../hooks/useBinderValue.ts";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { companionBase } from "../../services/companionApi.ts";
import { fetchJson } from "../../services/http.ts";
import {
  conditionLabel,
  countBinder,
  hasFacingPages,
  pageGroups,
  specFor,
} from "../../models/binderLayout.ts";
import { finishLabel } from "../../models/finishes.ts";
import { parseTradeShare, tradeRows, type TradeRow, type TradeShare } from "../../models/tradeShare.ts";
import { formatUsd } from "../../utils/format.ts";
import styles from "./TradeShareScreen.module.css";

/**
 * Somebody's trade binder, from a link.
 *
 * Read-only by construction and needs nothing from the visitor — no token, no
 * collection, no account. Most people who open this page will never open
 * another screen in this app, so it answers its two questions on its own: what
 * is on offer, and what is it worth.
 *
 * Two views of one binder, and the difference is what each is FOR. The binder
 * view is the map — it is how the owner sees it, so "the Umbreon on page two"
 * means the same thing to both of you. The list is the decision — sorted by
 * value, priced per copy. They are bound together by the POCKET ADDRESS: tap a
 * row and the pocket it names is scrolled to and lit, because the next thing
 * that happens after finding a card is asking for it by name.
 *
 * No ownership is drawn. A trade binder states what its owner will give up;
 * whether they also keep a second copy is their business, exactly as excluded
 * printings are on a shared set.
 */

/**
 * Polled rather than pushed, matching the live set share: a binder changes when
 * a human moves a card, which is minutes apart at best, and refetching on focus
 * is what actually makes it feel current.
 */
const POLL_MS = 60_000;

type SortKey = "value" | "pocket" | "name";

const SORTS: { key: SortKey; label: string }[] = [
  // Value first and by default: a visitor is scanning for the best thing here,
  // not reading the binder front to back.
  { key: "value", label: "Value" },
  { key: "pocket", label: "Pocket" },
  { key: "name", label: "Name" },
];

export function TradeShareScreen({ shareId }: { shareId: string }) {
  const { openSets } = useNavigation();
  const base = companionBase();

  const query = useQuery<TradeShare>({
    queryKey: ["trade-share", shareId],
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    // A revoked or mistyped link is a permanent answer, not a blip worth
    // retrying three times while the visitor waits.
    retry: (count, err) => !(err instanceof Error && err.message.includes("Not found")) && count < 1,
    queryFn: async ({ signal }) => {
      const raw = await fetchJson(`${base}/share/${encodeURIComponent(shareId)}`, { signal });
      const parsed = parseTradeShare(raw);
      // Also the path a SET share takes when its link is opened as a trade one.
      // Both mean "this is not a trade binder", and neither is worth a second
      // error state the visitor cannot act on differently.
      if (!parsed) throw new Error("Not found");
      return parsed;
    },
  });

  if (query.isLoading) {
    return (
      <Screen title="Trade binder" canGoBack>
        <LoadingState label="Loading trade binder…" />
      </Screen>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Screen
        title="Trade binder"
        headerLeft={
          <button type="button" className={styles.brand} onClick={openSets}>
            CardLens
          </button>
        }
        canGoBack
      >
        {/* Revoked, deleted and never-existed read the same on purpose — the
            server does not distinguish them, so neither can this. */}
        <ErrorState
          message="This trade link is no longer shared"
          onRetry={() => void query.refetch()}
          retryFocused={false}
        />
      </Screen>
    );
  }

  return <TradeView share={query.data} onBrand={openSets} />;
}

function TradeView({ share, onBrand }: { share: TradeShare; onBrand: () => void }) {
  const { binder } = share;
  const [view, setView] = useState<"binder" | "list">("binder");
  const [sort, setSort] = useState<SortKey>("value");
  /** The pocket a list row last pointed at, lit until another is chosen. */
  const [lit, setLit] = useState<string | null>(null);

  const value = useBinderValue(binder);
  const counts = countBinder(binder);
  const rows = useMemo(() => tradeRows(binder), [binder]);

  const sorted = useMemo(() => {
    const withPrice = rows.map((row) => ({ row, line: value.lineTotalFor(row.slot) }));
    if (sort === "pocket") return withPrice;
    if (sort === "name") {
      return [...withPrice].sort((a, b) =>
        (a.row.slot.name ?? a.row.slot.cardId).localeCompare(b.row.slot.name ?? b.row.slot.cardId),
      );
    }
    // Unpriced cards sink rather than sorting as zero: "we do not know" is not
    // "worth nothing", and the bottom is the honest place for something the
    // sort cannot rank.
    return [...withPrice].sort((a, b) => (b.line ?? -1) - (a.line ?? -1));
  }, [rows, sort, value]);

  /**
   * Jump to the pocket a row names.
   *
   * The whole reason both views exist: you find a card in the list, then you
   * want to see where it sits so you can ask for it the way its owner will
   * recognise. The view switches first, because the pocket is not in the DOM
   * until the binder is on screen.
   */
  const showPocket = (row: TradeRow) => {
    const key = `${row.page - 1}:${row.pocket - 1}`;
    setView("binder");
    setLit(key);
    requestAnimationFrame(() => {
      document.querySelector(`[data-pocket="${key}"]`)?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    });
  };

  return (
    // The header says what KIND of page this is, and the page says which
    // binder — the same title the loading and error states carry, so the chrome
    // does not change identity once the data lands. Putting the binder's name
    // in both printed it twice, a few pixels apart.
    <Screen
      title="Trade binder"
      headerLeft={
        <button type="button" className={styles.brand} onClick={onBrand}>
          CardLens
        </button>
      }
      canGoBack
    >
      {" "}
      <header className={styles.hero}>
        <p className={styles.eyebrow}>For trade</p>
        <h2 className={styles.name}>{binder.name}</h2>
        <p className={styles.meta}>
          {counts.copies} card{counts.copies === 1 ? "" : "s"} in {counts.cards} pocket
          {counts.cards === 1 ? "" : "s"} · {binder.pages.length} page
          {binder.pages.length === 1 ? "" : "s"} · {specFor(binder.format).label}
        </p>

        {/*
          The total, and immediately under it what it does not include. The two
          belong together: a binder full of promos nothing prices would
          otherwise read as nearly worthless rather than as unmeasured.
        */}
        <p className={styles.total}>{value.isLoading ? "Pricing…" : formatUsd(value.total)}</p>
        <p className={styles.totalNote}>
          {value.isLoading
            ? "Asking for the price of every set in this binder."
            : `${value.pricedCopies} of ${counts.copies} cards priced` +
              (value.unpriced > 0 ? ` · ${value.unpriced} pockets have no market price` : "")}
        </p>
      </header>
      <div className={styles.views} role="group" aria-label="View">
        {(["binder", "list"] as const).map((v) => (
          <button
            key={v}
            type="button"
            className={`${styles.chip} ${view === v ? styles.chipOn : ""}`}
            aria-pressed={view === v}
            onClick={() => setView(v)}
          >
            {v === "binder" ? "Binder" : "List"}
          </button>
        ))}
      </div>
      {view === "binder" ? (
        <div data-testid="trade-binder">
          {/* Laid out the way the binder actually falls open — page 1 alone
              against the inside cover, then facing pairs. Same rule as the
              builder, so the owner and the visitor look at one object. */}
          {pageGroups(binder.pages.length, binder.format).map((spread) => (
            <div
              key={spread[0]}
              className={styles.spread}
              data-single={spread.length === 1 || undefined}
              // 4-pocket has no facing pages — see hasFacingPages. The trade
              // page follows the builder exactly here, or the owner and the
              // visitor would be looking at differently shaped objects.
              data-solo={!hasFacingPages(binder.format) || undefined}
              data-cover={(hasFacingPages(binder.format) && spread[0] === 0) || undefined}
              // The page is as many pockets wide as the format has columns, so
              // a card is the same size in every format and in the builder.
              // Set here rather than on the page because the cover leaf beside
              // it needs the width too. See TradeShareScreen.module.css.
              style={{ "--binder-cols": specFor(binder.format).cols } as CSSProperties}
              // The format itself, so a 4-pocket page can draw the bigger
              // pockets it exists for. See web-theme.css.
              data-binder-format={binder.format}
            >
              {" "}
              {spread.map((i) => (
                <BinderPageView
                  key={i}
                  page={binder.pages[i]}
                  format={binder.format}
                  // Everything in a trade binder is on offer. There is no
                  // "don't own" state to draw here, and shadowing half the page
                  // against the VISITOR's collection would be a lie about whose
                  // binder this is.
                  owns={() => true}
                  pageNumber={i + 1}
                  priceFor={value.priceFor}
                  trade
                  selectedIndex={lit?.startsWith(`${i}:`) ? Number(lit.split(":")[1]) : null}
                />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div data-testid="trade-list">
          <div className={styles.sorts} role="group" aria-label="Sort by">
            <span className={styles.sortLabel}>Sort</span>
            {SORTS.map((s) => (
              <button
                key={s.key}
                type="button"
                className={`${styles.chip} ${sort === s.key ? styles.chipOn : ""}`}
                aria-pressed={sort === s.key}
                onClick={() => setSort(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>

          {sorted.length === 0 ? (
            <p className={styles.notice}>
              Nothing is in this binder yet. The link stays live, so cards will appear here as its owner adds
              them.
            </p>
          ) : (
            <ul className={styles.rows}>
              {sorted.map(({ row, line }) => (
                <TradeListRow
                  key={`${row.page}:${row.pocket}`}
                  row={row}
                  unit={value.priceFor(row.slot)}
                  line={line}
                  onShow={() => showPocket(row)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
      <p className={styles.footnote}>
        Prices are the market price for that exact printing, from the same public data the rest of CardLens
        uses. Condition is stated by the owner and never changes a price — a lightly played card is listed at
        the market price of the card, not at a discount this app invented.
      </p>
    </Screen>
  );
}

/**
 * One card in the list.
 *
 * The address leads because it is what the visitor will say out loud, and the
 * line total ends the row because it is what they are deciding on. The unit
 * price appears only when there is more than one copy — printing "$180 each"
 * beside "$180" would be the same number twice.
 */
function TradeListRow({
  row,
  unit,
  line,
  onShow,
}: {
  row: TradeRow;
  unit: number | undefined;
  line: number | undefined;
  onShow: () => void;
}) {
  const { slot, copies } = row;

  return (
    <li className={styles.row}>
      <button
        type="button"
        className={styles.rowButton}
        onClick={onShow}
        aria-label={`${slot.name ?? slot.cardId}, page ${row.page} pocket ${row.pocket}. Show in the binder.`}
      >
        <span className={styles.address}>{pocketAddress(row.page, row.pocket - 1)}</span>
        <CardImage src={slot.imageSmall} alt="" size="thumb" />
        <span className={styles.rowText}>
          <span className={styles.rowName}>{slot.name ?? slot.cardId}</span>
          {/* What the card IS. The copies moved out of this line and into the
              money column, where they are the multiplier — leaving room for the
              condition, which was the first thing to be cut off on a phone and
              the last thing a trader wants elided. */}
          <span className={styles.rowMeta}>
            {[
              slot.collectorNumber,
              finishLabel(slot.finish),
              slot.condition && conditionLabel(slot.condition),
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
        <span className={styles.rowMoney}>
          <span className={styles.rowLine}>{formatUsd(line)}</span>
          {/* The arithmetic when there is any, and the bare count when there is
              not: "3 × Unavailable" is not a sum, but the fact that there are
              three of them is still what the viewer is deciding about. */}
          {copies > 1 ? (
            <span className={styles.rowUnit}>
              {unit === undefined ? `${copies} copies` : `${copies} × ${formatUsd(unit)}`}
            </span>
          ) : null}{" "}
        </span>{" "}
      </button>
    </li>
  );
}
