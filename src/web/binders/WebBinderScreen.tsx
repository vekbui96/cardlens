import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Screen } from "../../components/Screen.tsx";
import { BackRow } from "../../components/BackRow.tsx";
import { CardImage } from "../../components/CardImage.tsx";
import { BinderPageView } from "../../components/BinderPage.tsx";
import { useSets } from "../../hooks/useSets.ts";
import { useBinderValue } from "../../hooks/useBinderValue.ts";
import { useSetView } from "../../hooks/useSetView.ts";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useLibrary } from "../../app/LibraryProvider.tsx";
import { useRepositories } from "../../app/contexts.tsx";
import {
  addPage,
  addressKey,
  canRemoveLastPage,
  countBinder,
  fillSequential,
  moveSlot,
  nextEmptyPocket,
  preferredFinish,
  putAt,
  removeLastPage,
  slotAt,
  specFor,
  hasFacingPages,
  pageGroups,
  type BinderAddress,
  type BinderSlot,
} from "../../models/binderLayout.ts";
import { useBinderDrag, type DragSource } from "../../features/binders/useBinderDrag.ts";
import { BinderCoverLeaf } from "./BinderCoverLeaf.tsx";
import { finishLabel } from "../../models/finishes.ts";
import { formatUsd } from "../../utils/format.ts";
import type { PokemonCardSummary } from "../../models/cards.ts";
import { BinderSearchResults } from "./BinderSearchResults.tsx";
import { BinderPocketSheet } from "./BinderPocketSheet.tsx";
import { BinderSettings } from "./BinderSettings.tsx";
import { resizeToDataUrl } from "../../utils/imageResize.ts";
import { imageSlotSrc, uploadBinderImage } from "../../services/sync/binderImages.ts";
import { SyncAuthError, SyncDisabledError, SyncTooLargeError } from "../../services/sync/http.ts";
import styles from "./WebBinderScreen.module.css";

/**
 * Say what actually went wrong.
 *
 * A single "could not add image" would collapse four different situations —
 * wrong token, sync switched off at the server, a file that is not an image,
 * and no connection — into one message that tells the user nothing about which
 * of them to fix.
 */
function imageErrorMessage(err: unknown): string {
  if (err instanceof SyncAuthError) return "The server rejected this device's sync token.";
  if (err instanceof SyncDisabledError) return "The server has sync switched off, so it cannot hold images.";
  if (err instanceof SyncTooLargeError) return "That image is too large, even after resizing.";
  if (err instanceof Error && err.message) return err.message;
  return "Could not reach the server to store that image.";
}

/**
 * Lay out one binder.
 *
 * Tap a pocket, then tap a card — rather than drag and drop, which on a phone
 * fights the scroll of a page taller than the screen and has no keyboard
 * equivalent. Select-then-place works with a finger, a mouse and a keyboard
 * without three separate implementations.
 *
 * Cards are offered from a set at a time, owned or not: planning a binder is
 * mostly deciding where the ones you are still chasing will go, so an unowned
 * card must be placeable. It renders shadowed — see BinderPage.
 */
export function WebBinderScreen({ binderId }: { binderId: string }) {
  const { pop } = useNavigation();
  const repo = useRepositories();
  const { ownedFinishes, binders, saveBinder } = useLibrary();

  const binder = binders.find((b) => b.id === binderId) ?? null;

  /**
   * What is being filled: a pocket, or the cover.
   *
   * An address rather than `{page, index}` since the cover became fillable. A
   * sentinel page number was the alternative and it leaks: `nextEmptyPocket`
   * and `placeSlot` both do arithmetic on `page`, and `-1` is a number they
   * would happily accept.
   */
  const [selected, setSelected] = useState<BinderAddress | null>(null);
  /**
   * The picker rail, open or shut. Desktop only — below 1000px the picker is a
   * bottom sheet that appears with a selection and there is nothing to collapse.
   *
   * Shut until it is wanted, and opened by choosing a pocket. That is not a
   * preference, it is arithmetic: the rail is 340px, and two 12-pocket pages at
   * the app's 130px pocket need 1108px of the 1180px shell. Open by default,
   * the spread has 804px and draws a 92px pocket in a 12-pocket binder against
   * a 125px one in a 9 — which is precisely the "same card at three sizes
   * depending on which binder it was filed in" bug that `--cl-binder-pocket`
   * exists to have fixed (see web-theme.css).
   *
   * So the binder keeps the whole shell until you ask for cards, and the moment
   * you do — by selecting a pocket, or by pressing the handle — the rail takes
   * its width. Shrinking the pockets is then something the user did, and one
   * press puts it back.
   */
  const [railOpen, setRailOpen] = useState(false);
  const [setId, setSetId] = useState("me5");
  const [setName, setSetName] = useState("Pitch Black");
  const [searchInput, setSearchInput] = useState("");
  /** The SUBMITTED query. Typing does not search: pokemontcg.io fails in bursts
      and rate-limits, and a request per keystroke would spend that budget on
      prefixes nobody asked about. */
  const [search, setSearch] = useState("");
  /** A search result awaiting a printing. Held here, not in the results list,
      so the sheet that asks can sit at the BOTTOM of the picker while the
      results stay on screen above it. */
  const [chosen, setChosen] = useState<PokemonCardSummary | null>(null);
  const [uploading, setUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  // ALL sets, not just collected ones: a binder is a plan, and planning a
  // set you have not started is the common case.
  const { data: allSets } = useSets();
  // Priced per printing, one request per SET rather than per card.
  const value = useBinderValue(binder);
  const view = useSetView(setId, setName, { rarities: null, wantPrintings: true });

  const owns = useMemo(
    () => (slot: BinderSlot) =>
      slot.kind === "image" ? true : ownedFinishes(slot.cardId).includes(slot.finish),
    [ownedFinishes],
  );

  /**
   * Keep the pocket being filled on screen.
   *
   * The picker is a sticky half of a phone display, so the page it is filling
   * scrolls out from under it — and after a place the selection moves to a
   * pocket that may be further down still. Without this the binder is filled
   * blind: cards land somewhere and the only evidence is the counter.
   */
  const selectedKey = selected ? addressKey(selected) : null;
  const lastScrolled = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedKey || selectedKey === lastScrolled.current) return;
    lastScrolled.current = selectedKey;
    document
      .querySelector(`[data-pocket="${selectedKey}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [selectedKey]);

  /**
   * A drag landed. Move what was picked up, or drop in something new.
   *
   * Two different writes on purpose. Moving SWAPS, because the card leaving the
   * source pocket has to go somewhere and destroying it would have no undo.
   * A card dragged out of the search results REPLACES, because it came from the
   * catalog and there is nothing to swap back — the same rule `placeSlot`
   * already documents for putting a card into an occupied sleeve.
   */
  const drop = (source: DragSource, slot: BinderSlot, to: BinderAddress) => {
    // Hooks run before the not-found early return below, so this one is
    // defined against a binder that may not exist yet.
    if (!binder) return;
    if (source.kind === "new") {
      saveBinder(putAt(binder, to, slot, Date.now()));
      setSelected(to);
      return;
    }
    saveBinder(moveSlot(binder, source.at, to, Date.now()));
  };

  const { drag, onPointerDown, consumeClick } = useBinderDrag(drop);
  const dropTarget = drag?.over ?? null;
  const draggingFrom = drag && drag.source.kind === "address" ? addressKey(drag.source.at) : null;

  if (!binder) {
    return (
      <Screen title="Binder" headerLeft={<BackRow focused={false} onActivate={pop} />} canGoBack>
        <p className={styles.notice}>That binder no longer exists.</p>
      </Screen>
    );
  }

  const spec = specFor(binder.format);
  const counts = countBinder(binder);

  /**
   * No trimming. It used to run on every commit, which meant "Add page" grew
   * the binder and the same call immediately dropped the new empty page again
   * — the button did nothing, silently. Trailing empties are now the user's to
   * remove, with the button next to the one that adds them.
   */
  const commit = (next: typeof binder) => saveBinder(next);

  /** What the selected pocket already holds — a card, or nothing to describe. */
  const selectedSlot = selected ? slotAt(binder, selected) : null;

  const place = (slot: BinderSlot | null) => {
    /*
     * With no selection, a card goes in the first empty pocket.
     *
     * On desktop the picker is a rail that is open whether or not a pocket is
     * chosen, so "click a card having chosen nothing" is now a normal thing to
     * do rather than an impossible one — and refusing it would make the rail a
     * shop window. The first empty pocket is the same answer `place` already
     * gives after every successful placement, so filling a binder by clicking
     * card after card lands them in the order they were clicked.
     */
    const at = selected ?? (slot ? nextEmptyPocket(binder, { page: 0, index: -1 }) : null);
    if (!at) return;
    const next = putAt(binder, at, slot, Date.now());
    commit(next);
    // Filling a pocket is a step in a sequence, so the selection moves on:
    // leaving it put meant the NEXT card replaced the one just placed, and a
    // binder that refuses to grow past one card looks like a broken picker.
    // Clearing a pocket is an edit to that pocket alone — stay on it, or
    // "Clear" would jump the selection away from what was just emptied.
    //
    // The COVER is not part of that sequence: it is one slot, and advancing off
    // it into page 1 pocket 1 would be the app deciding you meant to carry on
    // filling pages when you were setting a cover.
    if (slot) setSelected(at.kind === "cover" ? at : nextEmptyPocket(next, at));
    setChosen(null);
  };

  /**
   * A completed drag leaves a click behind on whatever it was dropped on.
   *
   * Swallowed here rather than in the hook, because it is the SELECTION that
   * must not happen. Rearranging a binder is not filling one: dropping a card
   * into pocket 5 and having the picker open on pocket 5 answers a question
   * nobody asked, and does it once per card while a page is being tidied.
   *
   * A card dragged in from the RAIL is the other case and `drop` selects it
   * deliberately — that IS filling, and the sheet it opens is where copies,
   * condition and "I own this" are set for the card just placed.
   */
  const selectAt = (at: BinderAddress) => {
    if (consumeClick()) return;
    setChosen(null);
    // Read outside the updater: a setState inside another one runs twice under
    // StrictMode, and this one is not a pure function of the previous value.
    const same = selected !== null && addressKey(selected) === addressKey(at);
    // Choosing a pocket IS asking for cards, so the rail comes out with it.
    // Deselecting leaves it as it is: shutting the picker because you tapped
    // the same pocket twice would take the card list away mid-fill.
    if (!same) setRailOpen(true);
    setSelected(same ? null : at);
  };

  /**
   * Rewrite the selected pocket and STAY on it.
   *
   * Counting a second copy is an edit to the pocket in front of you, not the
   * next step in filling the binder — so unlike `place` it does not advance the
   * selection. Sharing one function would move the sheet off the card the user
   * is still counting.
   */
  const update = (slot: BinderSlot) => {
    if (!selected) return;
    commit(putAt(binder, selected, slot, Date.now()));
  };
  /**
   * Resize on the device, upload, then place the id.
   *
   * The order matters: the pocket is only filled once the server holds the
   * bytes. Placing first and uploading after would leave a pocket pointing at
   * an id that does not exist if the upload failed — and a binder that renders
   * a broken image on every other device is worse than one that says the
   * upload did not work.
   */
  const addImage = async (file: File) => {
    setImageError(null);
    const token = repo.getSyncSettings().token;
    if (!token) {
      setImageError("Connect this device to the server first — custom images are stored there, not here.");
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await resizeToDataUrl(file);
      const imageId = await uploadBinderImage(token, dataUrl);
      place({ kind: "image", imageId, label: file.name.replace(/\.[^.]+$/, "").slice(0, 120) });
    } catch (err) {
      console.warn("[cardlens] binder image upload failed:", err);
      setImageError(imageErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Screen
      title={binder.name}
      headerLeft={<BackRow focused={false} onActivate={pop} />}
      headerRight={`${counts.filled}/${counts.pockets}`}
      canGoBack
    >
      {/* Page actions only. Everything that configures the binder itself —
          pocket size, pricing on the list, trading — lives in Settings below,
          because those are decided once and these are pressed constantly. */}
      <div className={styles.controls}>
        <button type="button" className={styles.chip} onClick={() => commit(addPage(binder, Date.now()))}>
          Add page
        </button>{" "}
        {/* Only offered when it would do something, and only for an EMPTY last
            page — removing one that holds cards would destroy them with no
            undo. */}
        <button
          type="button"
          className={styles.chip}
          disabled={!canRemoveLastPage(binder)}
          onClick={() => commit(removeLastPage(binder, Date.now()))}
        >
          Remove page
        </button>
      </div>
      <BinderSettings binder={binder} onSave={commit} />{" "}
      <div className={styles.controls}>
        <label className={styles.setPick}>
          <span className={styles.setPickLabel}>Set</span>
          <select
            className={styles.select}
            value={setId}
            onChange={(e) => {
              const next = (allSets ?? []).find((c) => c.id === e.target.value);
              setSetId(e.target.value);
              setSetName(next?.name ?? e.target.value);
            }}
          >
            {(allSets ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {/* One of each card, in collector order, at the printing a set binder
            is normally sleeved with. Replaces the pages - see fillSequential. */}
        <button
          type="button"
          className={styles.chip}
          disabled={view.cards.length === 0}
          onClick={() => {
            const slots = view.cards.flatMap((card) => {
              const finish = preferredFinish(view.finishesFor(card.collectorNumber, card.variants));
              if (!finish) return [];
              return [
                {
                  kind: "card" as const,
                  cardId: card.id,
                  finish,
                  name: card.name,
                  imageSmall: card.imageSmall,
                  collectorNumber: card.collectorNumber,
                },
              ];
            });
            commit(fillSequential(binder, slots, Date.now()));
            setSelected(null);
          }}
        >
          Fill with one of each
        </button>
      </div>
      {/* Changing format keeps reading order, not positions — a 4-wide page has
          no pocket matching the 9th of a 3-wide one. */}
      {/*
       * Pages on the left, the picker on the right — on a screen with room.
       *
       * Below 1000px this is a plain block and the picker is what it always
       * was: a sheet along the bottom that appears when a pocket is selected,
       * which is the right shape for one hand on a phone. On a desktop that
       * sheet spent the bottom third of a 1440x900 window on a card list while
       * the binder it was filling scrolled out of sight above it. The rail puts
       * both on screen at once, which is also what makes dragging a card from
       * the list into a pocket possible at all.
       */}
      <div className={styles.workspace} data-rail={railOpen ? "open" : "shut"}>
        <div className={styles.main}>
          <p className={styles.hint}>
            {selected
              ? selected.kind === "cover"
                ? "Cover selected — pick a card, or clear it."
                : `Pocket ${selected.index + 1} on page ${selected.page + 1} selected — pick a card, or clear it.`
              : "Tap a pocket to fill it, or drag a card from one pocket to another."}
          </p>
          {/* Laid out the way the binder actually falls open: page 1 alone, then
          facing pairs. A half spread keeps its empty right side rather than
          centring the page — that gap is where the next page goes, and the
          binder should look like it is waiting for it. */}
          {pageGroups(binder.pages.length, binder.format).map((spread) => (
            <div
              key={spread[0]}
              className={styles.spread}
              data-single={spread.length === 1 || undefined}
              // A format with no facing pages is one page per row, full width —
              // not half a spread with an empty side waiting for a neighbour that
              // is never coming. See hasFacingPages.
              data-solo={!hasFacingPages(binder.format) || undefined}
              // Page 1 opens on the RIGHT, against the inside front cover — the
              // same reason a book's first page is a right-hand page. Every later
              // lone page is a trailing even one, which sits on the left with its
              // facing side still to be added. Meaningless without facing pages.
              data-cover={(hasFacingPages(binder.format) && spread[0] === 0) || undefined}
              // How many pockets across a page is, which on a wide screen is what
              // the page is MADE of rather than what it gets divided into. The
              // stylesheet needs it here, on the spread, because the cover leaf is
              // drawn beside the page and CSS cannot read a child's custom
              // property. See WebBinderScreen.module.css.
              style={{ "--binder-cols": specFor(binder.format).cols } as CSSProperties}
              // The format itself, so a 4-pocket page can draw the bigger
              // pockets it exists for. See web-theme.css.
              data-binder-format={binder.format}
            >
              {" "}
              {/* The leaf page 1 opens against, and the one slot every binder has.
              Rendered inside the first spread so it takes the empty left-hand
              column; on a phone, and on a format with no facing pages, the
              stylesheet drops it to its own row above page 1 instead. */}
              {spread[0] === 0 ? (
                <BinderCoverLeaf
                  binder={binder}
                  selected={selected?.kind === "cover"}
                  onSelect={() => selectAt({ kind: "cover" })}
                  onPointerDown={(slot, event) =>
                    onPointerDown(event, { kind: "address", at: { kind: "cover" } }, slot)
                  }
                  dropOver={dropTarget === "cover"}
                  dragging={draggingFrom === "cover"}
                />
              ) : null}
              {spread.map((i) => (
                <BinderPageView
                  key={i}
                  page={binder.pages[i]}
                  format={binder.format}
                  owns={owns}
                  pageNumber={i + 1}
                  priceFor={value.priceFor}
                  // The owner sees the same marks the recipient will, so what is
                  // laid out here is what gets sent — no separate preview to drift.
                  trade={Boolean(binder.forTrade)}
                  selectedIndex={selected?.kind === "pocket" && selected.page === i ? selected.index : null}
                  dropTarget={dropTarget}
                  draggingFrom={draggingFrom}
                  onSlotClick={(index) => selectAt({ kind: "pocket", page: i, index })}
                  onSlotPointerDown={(index, slot, event) =>
                    onPointerDown(event, { kind: "address", at: { kind: "pocket", page: i, index } }, slot)
                  }
                />
              ))}
            </div>
          ))}
        </div>
        <aside className={styles.rail} data-idle={!selected || undefined} aria-label="Cards">
          {/* Desktop only. The bottom sheet has nothing to collapse — it is
              already absent until a pocket is selected. */}
          <div className={styles.railHead}>
            <button
              type="button"
              className={styles.railToggle}
              aria-expanded={railOpen}
              onClick={() => setRailOpen((open) => !open)}
            >
              <span aria-hidden="true">{railOpen ? "›" : "‹"}</span>
              <span className={styles.railToggleLabel}>{railOpen ? "Hide cards" : "Cards"}</span>
            </button>
          </div>
          <div className={styles.picker}>
            {/* Searching by name is the only way to reach a card whose set you do
              not remember — 218 sets in a dropdown is not a way to find one
              card. The set list below still answers the other question, "fill
              this binder from one set", which is how a master set gets built. */}
            <form
              className={styles.searchForm}
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(searchInput.trim());
              }}
            >
              <input
                className={styles.input}
                type="search"
                aria-label="Search every set"
                placeholder="Search every set — e.g. Umbreon VMAX"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
              <button type="submit" className={styles.chip} disabled={!searchInput.trim()}>
                Search
              </button>
              {search ? (
                <button
                  type="button"
                  className={styles.chip}
                  onClick={() => {
                    setSearch("");
                    setSearchInput("");
                  }}
                >
                  Browse sets
                </button>
              ) : null}
            </form>
            {/* The whole row goes while a search is up. The select would label a
              list it is not the source of, and custom art has nothing to do
              with a name search — and on a phone this row costs a row of
              pockets, which is the thing the picker exists to fill. */}
            {search ? null : (
              <div className={styles.pickerHead}>
                <label className={styles.setPick}>
                  <span className={styles.setPickLabel}>Cards from</span>
                  <select
                    className={styles.select}
                    value={setId}
                    onChange={(e) => {
                      const next = (allSets ?? []).find((c) => c.id === e.target.value);
                      setSetId(e.target.value);
                      setSetName(next?.name ?? e.target.value);
                    }}
                  >
                    {(allSets ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                {/* A photo, a divider, a proxy — anything the catalog has no entry
                for. The file is resized here and stored on the server, so the
                binder carries a 20-byte id rather than a data URI it would
                re-send on every edit. */}
                <label className={`${styles.chip} ${uploading ? styles.chipBusy : ""}`}>
                  {uploading ? "Uploading…" : "Add image"}
                  <input
                    type="file"
                    accept="image/*"
                    className={styles.fileInput}
                    disabled={uploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      // Reset first: picking the same file twice in a row fires no
                      // change event otherwise, so a failed upload could not be
                      // retried without choosing a different picture.
                      e.target.value = "";
                      if (file) void addImage(file);
                    }}
                  />
                </label>
              </div>
            )}
            {imageError ? (
              <p className={styles.error} role="alert">
                {imageError}
              </p>
            ) : null}
            {search ? (
              /* Keyed on the query so a new search starts at the results again
               rather than on the printings of a card the user has moved on
               from. */
              <BinderSearchResults
                key={search}
                query={search}
                ownedFinishes={ownedFinishes}
                onChoose={setChosen}
                compact={Boolean(chosen)}
              />
            ) : (
              <ul className={styles.cards}>
                {view.cards.flatMap((card) => {
                  const finishes = view.finishesFor(card.collectorNumber, card.variants);
                  const held = ownedFinishes(card.id);
                  return (finishes.length > 0 ? finishes : held).map((finish) => {
                    const owned = held.includes(finish);
                    // Denormalised so the page renders offline and before the
                    // catalog answers. Built once here because the click and the
                    // drag place the identical slot — two copies of this object
                    // is how they come to disagree about a field.
                    const slot: BinderSlot = {
                      kind: "card",
                      cardId: card.id,
                      finish,
                      name: card.name,
                      imageSmall: card.imageSmall,
                      collectorNumber: card.collectorNumber,
                    };
                    return (
                      <li key={`${card.id}:${finish}`}>
                        <button
                          type="button"
                          className={`${styles.card} ${owned ? "" : styles.cardWanted}`}
                          aria-label={`${card.name}, ${card.collectorNumber}, ${finishLabel(finish)}, ${
                            owned ? "owned" : "not owned"
                          }`}
                          onClick={() => {
                            // A drag that started here already placed the card.
                            if (consumeClick()) return;
                            place(slot);
                          }}
                          /* Draggable straight into a pocket. Only from THIS list
                           and not from the name-search results: a set row names
                           one printing, so there is a finish to place, while a
                           search result is a card whose printing has not been
                           chosen yet and would have to guess one. */
                          onPointerDown={(event) => onPointerDown(event, { kind: "new" }, slot)}
                        >
                          <CardImage src={card.imageSmall} alt="" size="fill" />
                          <span className={styles.cardMeta}>
                            {card.collectorNumber} · {finishLabel(finish)}
                          </span>
                        </button>
                      </li>
                    );
                  });
                })}
              </ul>
            )}
            {/* Last in the picker, so "which printing" is asked where the thumb
              already is, under the list it was asked about — and so a filled
              pocket can be marked owned without finding the card in the
              catalog a second time. */}
            {selected || chosen ? (
              <BinderPocketSheet
                chosen={chosen}
                slot={selectedSlot}
                pocketLabel={
                  !selected
                    ? "the first empty pocket"
                    : selected.kind === "cover"
                      ? "the cover"
                      : `pocket ${selected.index + 1}`
                }
                onPlace={place}
                onUpdate={update}
                onCancel={() => setChosen(null)}
                onClear={() => place(null)}
                priceFor={value.priceFor}
                forTrade={Boolean(binder.forTrade)}
              />
            ) : (
              /* The rail is open on desktop whether or not a pocket is chosen, so
               it has to say what clicking a card will do rather than leaving a
               blank strip where the sheet goes. */
              <p className={styles.railIdle}>
                Pick a pocket to fill, or drag a card onto one. A card clicked with nothing selected goes in
                the first empty pocket.
              </p>
            )}
          </div>
        </aside>
      </div>
      <p className={styles.footnote}>
        {/* On a trade binder the count that matters is COPIES — twelve pockets
            can hold thirty cards, and thirty is what is being offered. */}
        {binder.forTrade
          ? `${counts.copies} card${counts.copies === 1 ? "" : "s"} in ${counts.cards} pocket${
              counts.cards === 1 ? "" : "s"
            }`
          : `${counts.cards} card${counts.cards === 1 ? "" : "s"}`}{" "}
        across {binder.pages.length} page
        {binder.pages.length === 1 ? "" : "s"} · {spec.label}{" "}
        {/* The total is only ever "the part we know". Saying how many cards are
            unpriced alongside it is what keeps it from reading as the whole
            answer — stamps and promos price at nothing, and a binder of them
            would otherwise look worthless rather than unmeasured. */}
        {value.isLoading ? " · pricing…" : ` · ${formatUsd(value.total)}`}
        {!value.isLoading && value.unpriced > 0 ? ` (${value.unpriced} unpriced)` : ""}
      </p>
      {/*
       * The card under the pointer while it is being carried.
       *
       * Fixed to the viewport and `pointer-events: none`, which is not
       * cosmetic: the hit test that decides where the card lands is
       * `elementFromPoint` at the pointer, and a ghost that took events would
       * be the answer to every one of those tests.
       */}
      {drag ? (
        <div
          className={styles.ghost}
          style={{ left: drag.x, top: drag.y }}
          aria-hidden="true"
          data-over={drag.over ? "" : undefined}
        >
          {drag.slot.kind === "card" ? (
            <CardImage src={drag.slot.imageSmall} alt="" size="fill" />
          ) : (
            <img src={imageSlotSrc(drag.slot)} alt="" />
          )}
        </div>
      ) : null}
    </Screen>
  );
}
