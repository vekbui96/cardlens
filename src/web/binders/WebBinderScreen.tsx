import { useEffect, useMemo, useRef, useState } from "react";
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
  canRemoveLastPage,
  countBinder,
  fillSequential,
  nextEmptyPocket,
  placeSlot,
  preferredFinish,
  reformat,
  removeLastPage,
  specFor,
  toSpreads,
  type BinderFormat,
  type BinderSlot,
} from "../../models/binderLayout.ts";
import { finishLabel } from "../../models/finishes.ts";
import { formatUsd } from "../../utils/format.ts";
import type { PokemonCardSummary } from "../../models/cards.ts";
import { BinderSearchResults } from "./BinderSearchResults.tsx";
import { BinderPocketSheet } from "./BinderPocketSheet.tsx";
import { resizeToDataUrl } from "../../utils/imageResize.ts";
import { uploadBinderImage } from "../../services/sync/binderImages.ts";
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

  const [selected, setSelected] = useState<{ page: number; index: number } | null>(null);
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
  const selectedKey = selected ? `${selected.page}:${selected.index}` : null;
  const lastScrolled = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedKey || selectedKey === lastScrolled.current) return;
    lastScrolled.current = selectedKey;
    document
      .querySelector(`[data-pocket="${selectedKey}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [selectedKey]);

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
  const selectedSlot = (selected ? binder.pages[selected.page]?.slots[selected.index] : null) ?? null;

  const place = (slot: BinderSlot | null) => {
    if (!selected) return;
    const next = placeSlot(binder, selected.page, selected.index, slot, Date.now());
    commit(next);
    // Filling a pocket is a step in a sequence, so the selection moves on:
    // leaving it put meant the NEXT card replaced the one just placed, and a
    // binder that refuses to grow past one card looks like a broken picker.
    // Clearing a pocket is an edit to that pocket alone — stay on it, or
    // "Clear" would jump the selection away from what was just emptied.
    if (slot) setSelected(nextEmptyPocket(next, selected));
    setChosen(null);
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
      <div className={styles.controls}>
        <div className={styles.formats} role="group" aria-label="Binder format">
          {(["9", "12"] as BinderFormat[]).map((f) => (
            <button
              key={f}
              type="button"
              className={`${styles.chip} ${binder.format === f ? styles.chipOn : ""}`}
              aria-pressed={binder.format === f}
              onClick={() => commit(reformat(binder, f, Date.now()))}
            >
              {specFor(f).label}
            </button>
          ))}
        </div>
        <button type="button" className={styles.chip} onClick={() => commit(addPage(binder, Date.now()))}>
          Add page
        </button>
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
      <p className={styles.hint}>
        {selected
          ? `Pocket ${selected.index + 1} on page ${selected.page + 1} selected — pick a card below, or clear it.`
          : "Tap a pocket to fill it."}
      </p>

      {/* Laid out the way the binder actually falls open: page 1 alone, then
          facing pairs. A half spread keeps its empty right side rather than
          centring the page — that gap is where the next page goes, and the
          binder should look like it is waiting for it. */}
      {toSpreads(binder.pages.length).map((spread) => (
        <div
          key={spread[0]}
          className={styles.spread}
          data-single={spread.length === 1 || undefined}
          // Page 1 opens on the RIGHT, against the inside front cover — the
          // same reason a book's first page is a right-hand page. Every later
          // lone page is a trailing even one, which sits on the left with its
          // facing side still to be added.
          data-cover={spread[0] === 0 || undefined}
        >
          {spread.map((i) => (
            <BinderPageView
              key={i}
              page={binder.pages[i]}
              format={binder.format}
              owns={owns}
              pageNumber={i + 1}
              priceFor={value.priceFor}
              selectedIndex={selected?.page === i ? selected.index : null}
              onSlotClick={(index) => {
                setChosen(null);
                setSelected((cur) => (cur?.page === i && cur.index === index ? null : { page: i, index }));
              }}
            />
          ))}
        </div>
      ))}

      {selected ? (
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
                  return (
                    <li key={`${card.id}:${finish}`}>
                      <button
                        type="button"
                        className={`${styles.card} ${owned ? "" : styles.cardWanted}`}
                        aria-label={`${card.name}, ${card.collectorNumber}, ${finishLabel(finish)}, ${
                          owned ? "owned" : "not owned"
                        }`}
                        onClick={() =>
                          place({
                            kind: "card",
                            cardId: card.id,
                            finish,
                            // Denormalised so the page renders offline and before
                            // the catalog answers.
                            name: card.name,
                            imageSmall: card.imageSmall,
                            collectorNumber: card.collectorNumber,
                          })
                        }
                      >
                        <CardImage src={card.imageSmall} alt="" size="thumb" />
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
          <BinderPocketSheet
            chosen={chosen}
            slot={selectedSlot}
            pocketLabel={`pocket ${selected.index + 1}`}
            onPlace={place}
            onCancel={() => setChosen(null)}
            onClear={() => place(null)}
            priceFor={value.priceFor}
          />
        </div>
      ) : null}

      <p className={styles.footnote}>
        {counts.cards} card{counts.cards === 1 ? "" : "s"} across {binder.pages.length} page
        {binder.pages.length === 1 ? "" : "s"} · {spec.label}
        {/* The total is only ever "the part we know". Saying how many cards are
            unpriced alongside it is what keeps it from reading as the whole
            answer — stamps and promos price at nothing, and a binder of them
            would otherwise look worthless rather than unmeasured. */}
        {value.isLoading ? " · pricing…" : ` · ${formatUsd(value.total)}`}
        {!value.isLoading && value.unpriced > 0 ? ` (${value.unpriced} unpriced)` : ""}
      </p>
    </Screen>
  );
}
