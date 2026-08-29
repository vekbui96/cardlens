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
import { useSets } from "../../hooks/useSets.ts";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useLibrary } from "../../app/LibraryProvider.tsx";
import { useRepositories } from "../../app/contexts.tsx";
import { companionBase } from "../../services/companionApi.ts";
import { fetchJson } from "../../services/http.ts";
import { ProviderError } from "../../integrations/providers.ts";
import { CardSheet } from "./CardSheet.tsx";
import { SetSwitcher } from "./SetSwitcher.tsx";
import { SetTierStatus } from "../../features/collection/SetTierStatus.tsx";
import { setTiers } from "../../models/setCompletion.ts";
import { ownedIn } from "../../features/collection/completionTier.ts";
import { encodeShowcase } from "../../models/showcase.ts";
import { formatUsd } from "../../utils/format.ts";
import { screenToPath } from "../../app/screenUrl.ts";
import styles from "./WebSetCardsScreen.module.css";

/**
 * Why a live link could not be minted.
 *
 * Four causes with four different fixes, so they are four values rather than
 * one "it failed": entering a token here, re-entering a token here, setting one
 * on the SERVER, and waiting for a machine that is switched off are not the same
 * instruction, and a single message would send the user to look at the wrong one.
 */
type ShareFallback = "no-token" | "rejected" | "disabled" | "unreachable";

/**
 * What to say when Share had to fall back to a snapshot.
 *
 * Every line names the CAUSE and then what the link actually is, because the
 * snapshot is not merely a lesser link — it is a different object. It carries
 * ~2,000 characters of encoded ownership and freezes at the moment it was made,
 * so a collector who thinks they sent a live link will keep marking cards and
 * wonder why the recipient never sees them.
 */
const SHARE_FALLBACK_NOTICE: Record<ShareFallback, string> = {
  "no-token":
    "This device is not connected to the server, so Share made a snapshot: it is frozen at what you own right now and will never update. Connect the device on the Collection screen, then try again.",
  rejected:
    "The server rejected this device's sync token, so Share made a snapshot: it is frozen at what you own right now and will never update. Re-enter the token on the Collection screen, then try again.",
  disabled:
    "The server has sync switched off (no COLLECTION_TOKEN), so it cannot hold a live link. Share made a snapshot: it is frozen at what you own right now and will never update.",
  unreachable:
    "The server could not be reached, so Share made a snapshot: it is frozen at what you own right now and will never update.",
};

/**
 * Name the failure from what the request threw.
 *
 * Read from `ProviderError.status`, not from the message. The status used to be
 * recoverable only by regex over `"Request failed (401)"` — a format rather than
 * an interface, which stops matching the day someone rewords the string and
 * fails silently into "could not be reached".
 *
 * 401 and 503 are the two worth separating, and they are the same two sync
 * separates for the same reason: both stay broken until someone acts, and both
 * come from a server that is answering perfectly well. Calling either "could not
 * be reached" would have the user power-cycling a machine that is up.
 * `requireToken` in server/index.ts is where the 503 comes from — COLLECTION_TOKEN
 * unset there, which no amount of retrying from the device will fix.
 *
 * No status at all means there was no answer: a timeout, or nothing listening.
 * That is the one case "unreachable" genuinely describes.
 */
function shareFallbackFrom(err: unknown): ShareFallback {
  if (err instanceof ProviderError && err.status === 401) return "rejected";
  if (err instanceof ProviderError && err.status === 503) return "disabled";
  return "unreachable";
}
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
  const repo = useRepositories();
  const {
    ownedFinishes,
    toggleOwned,
    setOwnedMany,
    excludedFinishes,
    toggleExcluded,
    ownedCountsBySet,
    ownedFinishCountsBySet,
    ownedNumbersBySet,
    storageDegraded,
  } = useLibrary();
  const { data: sets } = useSets();
  const set = sets?.find((s) => s.id === setId);

  const [rarityKey, setRarityKey] = useState("all");
  /** Master-setting is mostly "what am I still missing", so it gets a real control. */
  const [missingOnly, setMissingOnly] = useState(false);
  /** Binder order is the default; value order answers a different question. */
  const [byValue, setByValue] = useState(false);
  /**
   * Excluded printings are hidden by default — they are not part of this set,
   * so leaving them in the grid is clutter that never resolves. Revealed on
   * demand rather than gone for good: a printing you cannot see is one you
   * cannot put back, and a card whose every printing is excluded would
   * otherwise vanish along with its sheet.
   */
  const [showExcluded, setShowExcluded] = useState(false);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  /** The transient "it worked" on the button; which kind of link it was matters. */
  const [copied, setCopied] = useState<"live" | "snapshot" | null>(null);
  /**
   * Set when the last Share degraded to a snapshot, and deliberately NOT
   * cleared on a timer.
   *
   * The button's confirmation flashes for 2.5 seconds, which is fine for "it
   * worked" and useless for "it worked, but not the way you asked". This is the
   * standing notice, and it stays until a live link actually succeeds.
   */
  const [shareFallback, setShareFallback] = useState<ShareFallback | null>(null);
  /** Minting can take the full 8s request timeout; a dead button for that long
      reads as a broken one, and invites a second press. */
  const [sharing, setSharing] = useState(false);

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
        const skipped = excludedFinishes(card.id);
        const extras = held.filter((f) => !available.includes(f));
        const finishes = [...available, ...extras];
        // No printings data yet: fall back to one slot for what is held, so the
        // grid degrades to "the cards you have" rather than to nothing.
        return (finishes.length > 0 ? finishes : held).map((finish) => ({
          collectorNumber: card.collectorNumber,
          // An excluded printing counts as done for binder-page purposes: the
          // page is complete when nothing on it is still wanted, and a promo
          // you have opted out of is not wanted.
          complete: held.includes(finish) || skipped.includes(finish),
          held: held.includes(finish),
          excluded: skipped.includes(finish),
          extra: extras.includes(finish),
          card,
          finish,
        }));
      }),
    [view, ownedFinishes, excludedFinishes],
  );

  type Slot = (typeof slots)[number];

  const excludedCount = useMemo(() => slots.filter((s) => s.excluded).length, [slots]);

  const visibleSlots = useMemo(() => {
    const shown = showExcluded ? slots : slots.filter((s) => !s.excluded);
    const visible = missingOnly ? shown.filter((s) => !s.held && !s.excluded) : shown;
    if (!byValue) return visible;
    // Copy before sorting: slots derives from memoised view.cards, and sorting
    // in place would mutate the binder order everything else reads.
    return [...visible].sort(
      (a, b) =>
        (view.priceFor(b.collectorNumber, b.finish) ?? 0) - (view.priceFor(a.collectorNumber, a.finish) ?? 0),
    );
  }, [slots, missingOnly, byValue, view, showExcluded]);

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
    const { card, finish, held, excluded, extra } = slot;
    const price = view.priceFor(card.collectorNumber, finish);
    return (
      <li key={`${card.id}:${finish}`}>
        {/* Not a <button> wrapping a <button> - that is invalid, and the nested
            control is unreachable by keyboard in several browsers. */}
        <div
          className={`${styles.tile} ${held ? styles.tileDone : ""} ${
            excluded ? styles.tileExcluded : ""
          } ${extra ? styles.tileExtra : ""}`}
        >
          <button
            type="button"
            className={styles.tileMark}
            aria-pressed={held}
            // Excluded is its own word, not "not owned": the difference between
            // "I still want this" and "this is not part of my set" is the whole
            // point of the state.
            aria-label={`${card.name}, ${card.collectorNumber}, ${finishLabel(finish)}${
              excluded ? ", excluded" : held ? ", owned" : ", not owned"
            }`}
            onClick={() => toggleOwned(card.id, finish, setId)}
          >
            {/* Dim rather than hide what is missing: a grid of greyed art is
                readable at a glance, a grid with holes in it is not. */}
            <CardImage src={card.imageSmall} alt="" size="thumb" />
            {held ? (
              <span className={styles.tickDone} aria-hidden="true">
                ✓
              </span>
            ) : null}
            {excluded ? (
              <span className={styles.excludedMark} aria-hidden="true">
                ✕
              </span>
            ) : null}
          </button>
          {/*
           * Name first, then number and pocket — the same caption the showcase
           * carries. A tile labelled only "Normal" cannot be scanned: the art
           * is 100px and identifying the card is exactly what the label is for.
           */}
          <button
            type="button"
            className={styles.tileInfo}
            onClick={() => setOpenCardId(card.id)}
            // Names the pocket it sits under, not just the card: a card with two
            // printings renders two of these, and identical labels make them
            // indistinguishable to a screen reader.
            aria-label={`Details for ${card.name}, ${card.collectorNumber}, ${finishLabel(finish)}`}
          >
            <span className={styles.tileName}>{card.name}</span>
            <span className={styles.tileFinish}>
              {card.collectorNumber} · {finishLabel(finish)}
            </span>
            {price !== undefined ? <span className={styles.tilePrice}>{formatUsd(price)}</span> : null}
          </button>
        </div>
      </li>
    );
  };

  /**
   * Ask the server for this set's live link.
   *
   * A live link rather than the old encoded snapshot: what you share stays
   * current as you mark cards, instead of freezing at the moment you sent it.
   * The server reuses one link per set, so asking twice does not leave a second
   * live link you have forgotten about and cannot see to revoke.
   *
   * Returns the reason instead of throwing, because the caller does not treat
   * this as an error — it degrades to a snapshot — and the reason is the part
   * the user has to be told.
   */
  const mintLiveLink = async (): Promise<{ path: string } | { failure: ShareFallback }> => {
    // Not a silent guard: the caller still produces a link AND says why it is
    // not the live one. A bare `return` here is the exact shape — an action
    // that does nothing and reports nothing — that has caused most of the
    // "it just doesn't work" bugs in this codebase.
    const token = repo.getSyncSettings().token;
    if (!token) return { failure: "no-token" };

    try {
      const created = (await fetchJson(`${companionBase()}/share`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ setId, setName }),
      })) as { id?: unknown };
      if (typeof created?.id !== "string") throw new Error("the server returned no share id");
      return { path: screenToPath({ name: "live", shareId: created.id }) };
    } catch (err) {
      // Logged as well as shown: the notice says which of three things to fix,
      // the console says what actually came back.
      console.warn("[cardlens] live share link failed, falling back to a snapshot:", err);
      return { failure: shareFallbackFrom(err) };
    }
  };

  /**
   * Build a link that carries this set's ownership inside it.
   *
   * The collection is local and syncs behind a token, so a page shared without
   * the server has to bring its data with it. Keyed by collector number rather
   * than card id: the recipient's app resolves names, art and prices from the
   * public catalog, and the link stays short enough to paste into a chat —
   * ~2,000 characters for a real set, which is the ceiling this path lives
   * under and the reason it is the fallback rather than the default.
   */
  const snapshotPath = () => {
    const owned = view.cards.flatMap((card) =>
      ownedFinishes(card.id).map((finish) => ({ collectorNumber: card.collectorNumber, finish })),
    );
    return screenToPath({
      name: "showcase",
      setId,
      setName,
      payload: encodeShowcase({ setId, owned }),
    });
  };

  /**
   * Share this set, and say WHICH link was shared.
   *
   * The snapshot fallback stays — a shareable link beats an error, and the
   * snapshot path needs nothing but the device itself. What does not stay is
   * the silence around it: this used to swap a live link for a frozen one and
   * flash "Snapshot link copied" for 2.5s, so the collector kept marking cards
   * into a link that had already stopped listening. The failure now gets a
   * standing notice naming the cause, and the notice carries the retry, so a
   * live link is one tap from the moment it failed.
   */
  const share = async () => {
    setSharing(true);
    try {
      const minted = await mintLiveLink();
      const failure = "failure" in minted ? minted.failure : null;
      const path = "failure" in minted ? snapshotPath() : minted.path;

      // Set from the mint, not from the copy: the server was unreachable
      // whether or not the share sheet was then cancelled, and clearing it on
      // success is what makes a retry visibly resolve.
      setShareFallback(failure);

      const url = `${window.location.origin}${window.location.pathname}#${path}`;
      try {
        // The share sheet where there is one — on a phone this is the difference
        // between sharing a set and copying a string into another app by hand.
        if (navigator.share) await navigator.share({ title: `${setName} — CardLens`, url });
        else await navigator.clipboard.writeText(url);
        setCopied(failure ? "snapshot" : "live");
        setTimeout(() => setCopied(null), 2500);
      } catch {
        // Cancelling the share sheet rejects, and that is not a failure.
      }
    } finally {
      setSharing(false);
    }
  };

  const ownedCards = ownedCountsBySet[setId] ?? 0;
  const ownedPrintings = ownedFinishCountsBySet[setId] ?? 0;
  /*
   * Three figures, each labelled, because they measure three different things:
   * the base run, the whole set, and printings across it. This header used to
   * show only the last of the three, unlabelled — so the same set read 197/408
   * here and 197/230 in the switcher directly beneath, and nothing said why.
   */
  const progress = (
    <SetTierStatus
      tiers={setTiers(
        {
          ...(set?.total ? { total: set.total } : {}),
          ...(set?.printedTotal ? { printedTotal: set.printedTotal } : {}),
        },
        ownedIn(setId, ownedNumbersBySet, ownedCards),
      )}
      {...(view.masterTotal ? { printings: { owned: ownedPrintings, total: view.masterTotal } } : {})}
    />
  );

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
        {excludedCount > 0 ? (
          <button
            type="button"
            className={`${styles.chip} ${showExcluded ? styles.chipOn : ""}`}
            aria-pressed={showExcluded}
            onClick={() => setShowExcluded((on) => !on)}
          >
            Excluded ({excludedCount})
          </button>
        ) : null}
        <button
          type="button"
          className={styles.chip}
          onClick={() => void share()}
          disabled={view.cards.length === 0 || sharing}
        >
          {sharing
            ? "Sharing…"
            : copied === "live"
              ? "Live link copied"
              : copied === "snapshot"
                ? "Snapshot link copied"
                : "Share"}
        </button>
      </div>

      {/*
       * Outside the sticky filter bar on purpose: it is a message about what
       * just happened, not a control, and pinning it to the top would either
       * eat a row of the grid forever or scroll away from the button it
       * explains. role="alert" so it is announced rather than merely drawn.
       */}
      {shareFallback ? (
        <div className={styles.shareFallback} role="alert">
          <p className={styles.shareFallbackText}>{SHARE_FALLBACK_NOTICE[shareFallback]}</p>
          {/* The retry lives in the notice so the fix is where the problem is
              stated. Offered even for a missing token: the token may have been
              entered in another tab since, and re-checking costs nothing. */}
          <button type="button" className={styles.chip} disabled={sharing} onClick={() => void share()}>
            Try live link
          </button>
        </div>
      ) : null}

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
          excluded={excludedFinishes(openCard.id)}
          onToggleExcluded={(finish: CollectFinish) => toggleExcluded(openCard.id, finish, setId)}
          onRemoveAll={() => {
            // Tombstones, not deleted rows: the collection is an OR-Set, so a
            // removal expressed as a missing row is indistinguishable from
            // "never seen" and a stale device resurrects it on the next sync.
            // One write for the card -- this looped toggleOwned, which rewrote
            // the whole collection once per printing held.
            setOwnedMany(
              ownedFinishes(openCard.id).map((finish) => ({
                cardId: openCard.id,
                finish,
                setId,
                owned: false,
              })),
            );
            setOpenCardId(null);
          }}
          storageDegraded={storageDegraded}
          onClose={() => setOpenCardId(null)}
        />
      ) : null}
    </Screen>
  );
}
