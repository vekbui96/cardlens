import { useEffect, useMemo, useState } from "react";
import { Screen } from "../../components/Screen.tsx";
import { BackRow } from "../../components/BackRow.tsx";
import { CardImage } from "../../components/CardImage.tsx";
import { LoadingState, ErrorState, EmptyState } from "../../components/States.tsx";
import { RARITY_FILTERS } from "../../features/results/rarityFilters.ts";
import { binderPages } from "../../models/binder.ts";
import { finishLabel } from "../../models/finishes.ts";
import type { CollectFinish } from "../../models/cards.ts";
import { useSetView } from "../../hooks/useSetView.ts";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useLibrary } from "../../app/LibraryProvider.tsx";
import { CardSheet } from "./CardSheet.tsx";
import { SetSwitcher } from "./SetSwitcher.tsx";
import { encodeShowcase } from "../../models/showcase.ts";
import { formatUsd } from "../../utils/format.ts";
import { screenToPath } from "../../app/screenUrl.ts";
import styles from "./WebSetCardsScreen.module.css";

/**
 * A set as a grid of card images, for a phone.
 *
 * The glasses render the same set as a focus-ring list of text rows, because
 * four gestures and a 600x600 additive display leave no room for anything else.
 * A phone has a finger, a scrollbar and a real screen, and collectors recognise
 * cards by art long before they read a collector number — so the art IS the
 * interface here, and marking happens in a sheet rather than through a mode.
 *
 * Both shells ask useSetView the same questions, so there is one answer to
 * "which printings does this card have" rather than two that can drift.
 */
export function WebSetCardsScreen({ setId, setName }: { setId: string; setName: string }) {
  const { pop } = useNavigation();
  const { ownedFinishes, toggleOwned, ownedCountsBySet, ownedFinishCountsBySet, storageDegraded } =
    useLibrary();

  const [rarityKey, setRarityKey] = useState("all");
  /** Master-setting is mostly "what am I still missing", so it gets a real control. */
  const [missingOnly, setMissingOnly] = useState(false);
  /** Binder order is the default; value order answers a different question. */
  const [byValue, setByValue] = useState(false);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [shared, setShared] = useState(false);

  /**
   * The switcher swaps sets under a screen that stays mounted, so anything
   * naming a specific card has to go. The filters deliberately do not: "missing
   * only" is a question asked of set after set. An open sheet would otherwise
   * survive on an id the new set does not contain.
   */
  useEffect(() => setOpenCardId(null), [setId]);

  const rarity = RARITY_FILTERS.find((f) => f.key === rarityKey) ?? RARITY_FILTERS[0];
  // Printings are wanted up front here: there is no collect mode to gate them
  // behind, and the badges on every tile depend on them.
  const view = useSetView(setId, setName, { rarities: rarity.rarities, wantPrintings: true });

  /**
   * One slot per PRINTING, not per card — the same model the showcase uses.
   *
   * A master set lives in a binder with the normal and the reverse in their own
   * pockets, so a single tile marked "1/2 printings" describes a pocket that
   * does not exist. Two tiles side by side is what is actually in front of you,
   * and it makes the missing one visible without opening anything.
   *
   * Extras — a hand-marked finish the set data does not know about — get a slot
   * too, so nothing already held can become invisible here.
   */
  const slots = useMemo(
    () =>
      view.cards.flatMap((card) => {
        const available = view.finishesFor(card.collectorNumber, card.variants);
        const held = ownedFinishes(card.id);
        const extras = held.filter((f) => !available.includes(f));
        const finishes = [...available, ...extras];
        // No printings data yet: fall back to one slot for what is held, so the
        // grid degrades to "the cards you have" rather than to nothing.
        return (finishes.length > 0 ? finishes : held).map((finish) => ({
          collectorNumber: card.collectorNumber,
          complete: held.includes(finish),
          extra: extras.includes(finish),
          card,
          finish,
        }));
      }),
    [view, ownedFinishes],
  );

  type Slot = (typeof slots)[number];

  const visibleSlots = useMemo(() => {
    const visible = missingOnly ? slots.filter((s) => !s.complete) : slots;
    if (!byValue) return visible;
    // Copy before sorting: slots derives from memoised view.cards, and sorting
    // in place would mutate the binder order everything else reads.
    return [...visible].sort(
      (a, b) =>
        (view.priceFor(b.collectorNumber, b.finish) ?? 0) - (view.priceFor(a.collectorNumber, a.finish) ?? 0),
    );
  }, [slots, missingOnly, byValue, view]);

  /**
   * Binder pages are only honest over an unbroken run in collector order. A
   * "Page 3" drawn over a rarity-filtered subset, a missing-only list or a
   * value sort names something that does not exist, so those modes get a flat
   * grid and a plain count instead.
   */
  const inBinderOrder = rarity.rarities === null && !missingOnly && !byValue;
  const pages = useMemo(
    () => (inBinderOrder ? binderPages(visibleSlots) : []),
    [inBinderOrder, visibleSlots],
  );

  const openCard = openCardId ? (view.cards.find((c) => c.id === openCardId) ?? null) : null;

  /**
   * One tile per printing, shared by the binder-page and flat-grid paths.
   *
   * The art is the toggle: with a finger you tap the printing itself, which is
   * why the glasses' collect mode and printing picker have no counterpart here.
   * The number is a separate control because the two are different intents —
   * marking a pocket, versus looking the card up.
   */
  const renderSlot = (slot: Slot) => {
    const { card, finish, complete, extra } = slot;
    const price = view.priceFor(card.collectorNumber, finish);
    return (
      <li key={`${card.id}:${finish}`}>
        {/* Not a <button> wrapping a <button> - that is invalid, and the nested
            control is unreachable by keyboard in several browsers. */}
        <div className={`${styles.tile} ${complete ? styles.tileDone : ""} ${extra ? styles.tileExtra : ""}`}>
          <button
            type="button"
            className={styles.tileMark}
            aria-pressed={complete}
            aria-label={`${card.name}, ${card.collectorNumber}, ${finishLabel(finish)}${
              complete ? ", owned" : ", not owned"
            }`}
            onClick={() => toggleOwned(card.id, finish, setId)}
          >
            {/* Dim rather than hide what is missing: a grid of greyed art is
                readable at a glance, a grid with holes in it is not. */}
            <CardImage src={card.imageSmall} alt="" size="thumb" />
            <span className={styles.tileFinish}>{finishLabel(finish)}</span>
            {complete ? (
              <span className={styles.tickDone} aria-hidden="true">
                ✓
              </span>
            ) : null}
          </button>
          <button
            type="button"
            className={styles.tileNumber}
            onClick={() => setOpenCardId(card.id)}
            // Names the pocket it sits under, not just the card: a card with two
            // printings renders two of these, and identical labels make them
            // indistinguishable to a screen reader.
            aria-label={`Details for ${card.name}, ${card.collectorNumber}, ${finishLabel(finish)}`}
          >
            <span>{card.collectorNumber}</span>
            {price !== undefined ? <span className={styles.tilePrice}>{formatUsd(price)}</span> : null}
          </button>
        </div>
      </li>
    );
  };

  /**
   * Build a link that carries this set's ownership and copy it.
   *
   * The collection is local and syncs behind a token, so a shareable page has
   * to bring its data with it. Keyed by collector number rather than card id:
   * the recipient's app resolves names, art and prices from the public catalog,
   * and the link stays short enough to paste into a chat.
   */
  const share = async () => {
    const owned = view.cards.flatMap((card) =>
      ownedFinishes(card.id).map((finish) => ({ collectorNumber: card.collectorNumber, finish })),
    );
    const path = screenToPath({
      name: "showcase",
      setId,
      setName,
      payload: encodeShowcase({ setId, owned }),
    });
    const url = `${window.location.origin}${window.location.pathname}#${path}`;
    try {
      // The share sheet where there is one — on a phone this is the difference
      // between sharing a set and copying a string into another app by hand.
      if (navigator.share) await navigator.share({ title: `${setName} — CardLens`, url });
      else await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch {
      // Cancelling the share sheet rejects, and that is not a failure.
    }
  };

  const ownedCards = ownedCountsBySet[setId] ?? 0;
  const ownedPrintings = ownedFinishCountsBySet[setId] ?? 0;
  const progress = view.masterTotal ? `${ownedPrintings}/${view.masterTotal}` : `${ownedCards}`;

  return (
    <Screen
      title={setName}
      headerLeft={<BackRow focused={false} onActivate={pop} />}
      headerRight={progress}
      titleControl={<SetSwitcher setId={setId} setName={setName} />}
      canGoBack
    >
      <div className={styles.filters}>
        <div className={styles.chips} role="group" aria-label="Filter by rarity">
          {RARITY_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`${styles.chip} ${f.key === rarityKey ? styles.chipOn : ""}`}
              aria-pressed={f.key === rarityKey}
              onClick={() => setRarityKey(f.key)}
            >
              {f.short}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`${styles.chip} ${styles.missing} ${missingOnly ? styles.chipOn : ""}`}
          aria-pressed={missingOnly}
          onClick={() => setMissingOnly((on) => !on)}
        >
          Missing only
        </button>
        <button
          type="button"
          className={`${styles.chip} ${byValue ? styles.chipOn : ""}`}
          aria-pressed={byValue}
          onClick={() => setByValue((on) => !on)}
        >
          By value
        </button>
        {/* Disabled until the set has loaded: the link is built from the cards
            on screen, so sharing early produces an empty showcase that looks
            like a collection of nothing. */}
        <button
          type="button"
          className={styles.chip}
          onClick={() => void share()}
          disabled={view.cards.length === 0}
        >
          {shared ? "Link copied" : "Share"}
        </button>
      </div>

      {view.isLoading ? <LoadingState label="Loading set…" /> : null}
      {/* retryFocused is a glasses affordance — there is no focus ring here. */}
      {view.isError ? (
        <ErrorState message="Couldn’t load set" onRetry={view.refetch} retryFocused={false} />
      ) : null}
      {!view.isLoading && !view.isError && visibleSlots.length === 0 ? (
        <EmptyState
          title={missingOnly ? "Nothing missing" : `No ${rarity.short} cards`}
          hint={missingOnly ? "Every card here is complete." : "Try another rarity."}
        />
      ) : null}

      {/* Filtered views are not binder pages, so they say what they are instead. */}
      {visibleSlots.length > 0 && !inBinderOrder ? (
        <p className={styles.summary}>
          <span className={styles.summaryCount}>{visibleSlots.length}</span>{" "}
          {visibleSlots.length === 1 ? "printing" : "printings"}
          {byValue ? " · most valuable first" : ""}
        </p>
      ) : null}

      {visibleSlots.length > 0 && !inBinderOrder ? (
        <ul className={styles.grid}>{visibleSlots.map(renderSlot)}</ul>
      ) : null}

      {pages.map((page) => (
        <section key={page.index} className={styles.page}>
          <h2 className={`${styles.pageMarker} ${page.full ? styles.pageFull : ""}`}>
            <span className={styles.pageName}>
              {page.full ? "✦ " : ""}Page {page.index}
            </span>
            <span className={styles.pageRange}>
              {page.from}–{page.to}
            </span>
            <span className={styles.pageCount}>
              {page.complete}/{page.cards.length}
            </span>
          </h2>
          <ul className={styles.grid}>{page.cards.map(renderSlot)}</ul>
        </section>
      ))}

      {openCard ? (
        <CardSheet
          card={openCard}
          finishes={view.finishesFor(openCard.collectorNumber, openCard.variants)}
          owned={ownedFinishes(openCard.id)}
          headlinePrice={view.headlinePriceFor(openCard)}
          priceFor={(finish) => view.priceFor(openCard.collectorNumber, finish)}
          onToggle={(finish: CollectFinish) => toggleOwned(openCard.id, finish, setId)}
          onRemoveAll={() => {
            // Toggle each held printing off rather than deleting rows: the
            // collection is an OR-Set, so a removal must be a tombstone or a
            // stale device resurrects it on the next sync.
            for (const finish of ownedFinishes(openCard.id)) toggleOwned(openCard.id, finish, setId);
            setOpenCardId(null);
          }}
          storageDegraded={storageDegraded}
          onClose={() => setOpenCardId(null)}
        />
      ) : null}
    </Screen>
  );
}
