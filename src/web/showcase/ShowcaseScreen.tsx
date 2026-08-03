import { useMemo } from "react";
import { Screen } from "../../components/Screen.tsx";
import { CardImage } from "../../components/CardImage.tsx";
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

  const pages = useMemo(() => binderPages(slots), [slots]);

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
          <ul className={styles.grid}>
            {page.cards.map(({ card, finish }) => {
              const held = (ownedByNumber.get(card.collectorNumber) ?? []).includes(finish);
              const price = view.priceFor(card.collectorNumber, finish);

              return (
                <li
                  key={`${card.id}|${finish}`}
                  className={held ? styles.tile : styles.tileMissing}
                  data-testid="showcase-slot"
                >
                  <CardImage src={card.imageSmall} alt="" size="thumb" />
                  <span className={styles.name}>{card.name}</span>
                  <span className={styles.meta}>
                    {card.collectorNumber} · {finishLabel(finish)}
                  </span>
                  {/* The price of THIS printing. A reverse and a normal of the
                      same card are routinely worth very different amounts, which
                      is most of the reason for separating them. */}
                  {held && price !== undefined ? (
                    <span className={styles.price}>{formatUsd(price)}</span>
                  ) : (
                    <span className={styles.missing}>{held ? "" : "missing"}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <p className={styles.footnote}>Shared from CardLens · prices are TCGplayer market, USD</p>
    </Screen>
  );
}
