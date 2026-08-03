import { useMemo, useState, useEffect } from "react";
import { Screen } from "../../components/Screen.tsx";
import { CardImage } from "../../components/CardImage.tsx";
import type { CollectFinish, PokemonCardSummary } from "../../models/cards.ts";
import { LoadingState, ErrorState } from "../../components/States.tsx";
import { binderPages } from "../../models/binder.ts";
import { finishLabel } from "../../models/finishes.ts";
import { decodeShowcase } from "../../models/showcase.ts";
import { formatUsd } from "../../utils/format.ts";
import { useSetView } from "../../hooks/useSetView.ts";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import styles from "./ShowcaseScreen.module.css";

/**
 * Somebody else's set, from a link.
 *
 * Read-only by construction: the ownership comes from the URL, not from this
 * device's collection, and nothing here writes. A visitor who already uses
 * CardLens sees the sharer's set, never their own — which is the one way this
 * screen could be actively misleading.
 *
 * Card data and prices come from the same public endpoints the app already
 * uses, so the link carries only WHICH printings are held, not a copy of the
 * catalog.
 */
interface ViewedSlot {
  card: PokemonCardSummary;
  finish: CollectFinish;
  held: boolean;
  price: number | undefined;
}

/**
 * One card, big.
 *
 * A visitor cannot tap through to a card detail screen — the showcase carries
 * its own data and there is nothing else to navigate to — so the large art has
 * to live here. Escape and the backdrop close it, matching CardSheet.
 */
function CardViewer({ slot, onClose }: { slot: ViewedSlot; onClose: () => void }) {
  const { card, finish, held, price } = slot;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={styles.viewerBackdrop} onClick={onClose} role="presentation">
      <div
        className={styles.viewer}
        role="dialog"
        aria-modal="true"
        aria-label={`${card.name}, ${finishLabel(finish)}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* imageLarge where the catalog has it: the whole point is seeing the
            art properly, and the thumb is 245px wide. */}
        <img className={styles.viewerArt} src={card.imageLarge ?? card.imageSmall} alt={card.name} />
        <div className={styles.viewerMeta}>
          <h2 className={styles.viewerName}>{card.name}</h2>
          <p className={styles.viewerLine}>
            {card.collectorNumber} · {finishLabel(finish)}
            {card.rarity ? ` · ${card.rarity}` : ""}
          </p>
          <p className={held ? styles.viewerHeld : styles.viewerMissing}>
            {held ? (price !== undefined ? `Owned · ${formatUsd(price)}` : "Owned") : "Missing"}
          </p>
        </div>
        <button type="button" className={styles.viewerClose} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

export function ShowcaseScreen({
  setId,
  setName,
  payload,
}: {
  setId: string;
  setName: string;
  payload: string;
}) {
  const { openSets } = useNavigation();
  /**
   * A visitor's two questions are "what have they got" and "what are they
   * still after" — the second is the one that makes a shared list useful to
   * someone holding spares.
   */
  const [missingOnly, setMissingOnly] = useState(false);
  const [viewing, setViewing] = useState<ViewedSlot | null>(null);
  const view = useSetView(setId, setName, { rarities: null, wantPrintings: true });

  /**
   * Owned printings, straight from the link, grouped by collector number.
   *
   * Deliberately NOT intersected with the set's known printings. The link is
   * already the authoritative statement of what the sharer holds, and making it
   * agree with a second source means a slow or failed printings fetch renders
   * the whole showcase as an empty binder — which is exactly what happened.
   */
  const ownedByNumber = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of decodeShowcase(setId, payload).owned) {
      const list = map.get(p.collectorNumber) ?? [];
      if (!list.includes(p.finish)) list.push(p.finish);
      map.set(p.collectorNumber, list);
    }
    return map;
  }, [setId, payload]);

  /**
   * One slot per PRINTING, not per card.
   *
   * A master set is arranged in a binder with the normal and the reverse in
   * their own pockets, so a tile that lists "Normal, Reverse Holo" describes
   * one slot holding two cards — which is not what is in front of anyone. The
   * slots are the set's known printings, plus any the link carries that the
   * set data does not know about, so a hand-marked pattern foil still shows.
   */
  const slots = useMemo(
    () =>
      view.cards.flatMap((card) => {
        const available = view.finishesFor(card.collectorNumber, card.variants);
        const held = ownedByNumber.get(card.collectorNumber) ?? [];
        const finishes = [...available, ...held.filter((f) => !available.includes(f))];
        // With no printings data at all, fall back to what the link holds, so
        // the showcase degrades to "only the owned cards" rather than nothing.
        return (finishes.length > 0 ? finishes : held).map((finish) => ({
          collectorNumber: card.collectorNumber,
          complete: held.includes(finish),
          card,
          finish,
        }));
      }),
    [view, ownedByNumber],
  );

  /**
   * Filtering breaks binder pages: "Page 3" over a filtered subset names
   * something that does not exist. Same rule the set screen follows.
   */
  const visible = useMemo(
    () => (missingOnly ? slots.filter((s) => !s.complete) : slots),
    [slots, missingOnly],
  );
  const pages = useMemo(() => (missingOnly ? [] : binderPages(visible)), [visible, missingOnly]);

  const totals = useMemo(() => {
    let held = 0;
    let value: number | undefined;
    for (const card of view.cards) {
      for (const finish of ownedByNumber.get(card.collectorNumber) ?? []) {
        held += 1;
        const price = view.priceFor(card.collectorNumber, finish);
        if (price !== undefined) value = (value ?? 0) + price;
      }
    }
    return { held, value };
  }, [view, ownedByNumber]);

  /** One pocket. Shared by the binder-page and filtered-grid paths. */
  const renderSlot = ({ card, finish }: { card: PokemonCardSummary; finish: CollectFinish }) => {
    const held = (ownedByNumber.get(card.collectorNumber) ?? []).includes(finish);
    const price = view.priceFor(card.collectorNumber, finish);

    return (
      <li
        key={`${card.id}|${finish}`}
        className={held ? styles.tile : styles.tileMissing}
        data-testid="showcase-slot"
      >
        {/* A button, not a bare image: the art is small on a phone, and opening
            it is the only way a visitor can actually look at the card. Still
            read-only — this opens a viewer, it never writes. */}
        <button
          type="button"
          className={styles.zoom}
          onClick={() => setViewing({ card, finish, held, price })}
          aria-label={`View ${card.name}, ${card.collectorNumber}, ${finishLabel(finish)}${
            held ? "" : ", missing"
          }`}
        >
          <CardImage src={card.imageSmall} alt="" size="thumb" />
        </button>
        <span className={styles.name}>{card.name}</span>
        <span className={styles.meta}>
          {card.collectorNumber} · {finishLabel(finish)}
        </span>
        {/* The price of THIS printing. A reverse and a normal of the same card
            are routinely worth very different amounts, which is most of the
            reason for separating them. */}
        {held && price !== undefined ? (
          <span className={styles.price}>{formatUsd(price)}</span>
        ) : (
          <span className={styles.missing}>{held ? "" : "missing"}</span>
        )}
      </li>
    );
  };

  const missingCount = slots.length - totals.held;

  return (
    <Screen
      title={setName}
      headerLeft={
        <button type="button" className={styles.brand} onClick={openSets}>
          CardLens
        </button>
      }
      headerRight={view.masterTotal ? `${totals.held}/${view.masterTotal}` : `${totals.held}`}
      canGoBack
    >
      {view.isLoading ? <LoadingState label="Loading set…" /> : null}
      {view.isError ? (
        <ErrorState message="Couldn’t load this set" onRetry={view.refetch} retryFocused={false} />
      ) : null}

      {view.cards.length > 0 ? (
        <p className={styles.summary}>
          <span className={styles.count}>{totals.held}</span> printings shown
          {totals.value !== undefined ? (
            <span className={styles.value}>{formatUsd(totals.value)}</span>
          ) : null}
        </p>
      ) : null}

      {/* The question someone else's list actually answers: what are they still
          after. Hidden until the set has loaded, because a filter over nothing
          reads as a broken control. */}
      {slots.length > 0 ? (
        <div className={styles.filters}>
          <button
            type="button"
            className={`${styles.chip} ${missingOnly ? styles.chipOn : ""}`}
            aria-pressed={missingOnly}
            onClick={() => setMissingOnly((on) => !on)}
          >
            Missing only
          </button>
          <span className={styles.filterCount}>
            {missingCount} of {slots.length} still missing
          </span>
        </div>
      ) : null}

      {missingOnly ? (
        visible.length > 0 ? (
          <ul className={styles.grid}>{visible.map(renderSlot)}</ul>
        ) : (
          <p className={styles.complete}>Nothing missing — this set is complete.</p>
        )
      ) : null}

      {pages.map((page) => (
        <section key={page.index} className={styles.page}>
          <h2 className={styles.marker}>
            <span>
              {page.full ? "✦ " : ""}Page {page.index}
            </span>
            <span className={styles.range}>
              {page.from}–{page.to}
            </span>
          </h2>
          {/* Nine to a page, three across — a real binder page, which is how
              the cards are actually arranged in front of the person sharing. */}
          <ul className={styles.grid}>{page.cards.map(renderSlot)}</ul>
        </section>
      ))}

      {viewing ? <CardViewer slot={viewing} onClose={() => setViewing(null)} /> : null}

      <p className={styles.footnote}>Shared from CardLens · prices are TCGplayer market, USD</p>
    </Screen>
  );
}
