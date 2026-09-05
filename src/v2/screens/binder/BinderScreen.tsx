import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Card, CardArt, Chip, Money, Panel, RailHost, Row, Sheet, Stack } from "../../primitives/index.ts";
import { useLibrary } from "../../../app/LibraryProvider.tsx";
import { useRepositories } from "../../../app/contexts.tsx";
import { screenToPath } from "../../../app/screenUrl.ts";
import { useBinderValue } from "../../../hooks/useBinderValue.ts";
import { useSets } from "../../../hooks/useSets.ts";
import { useSetView } from "../../../hooks/useSetView.ts";
import { useBinderDrag } from "../../../features/binders/useBinderDrag.ts";
import { resizeToDataUrl } from "../../../utils/imageResize.ts";
import { uploadBinderImage } from "../../../services/sync/binderImages.ts";
import {
  addPage,
  addressKey,
  countBinder,
  fillSequential,
  hasFacingPages,
  pageGroups,
  preferredFinish,
  putAt,
  removeLastPage,
  slotAt,
  nextEmptyPocket,
  type BinderAddress,
  type BinderSlot,
  type CardSlot,
} from "../../../models/binderLayout.ts";
import type { PokemonCardSummary } from "../../../models/cards.ts";
import { BinderCoverLeaf } from "./BinderCoverLeaf.tsx";
import { BinderPageView } from "./BinderPageView.tsx";
import { BinderPicker } from "./BinderPicker.tsx";
import { BinderSettings, SETTINGS_PANEL_ID } from "./BinderSettings.tsx";
import {
  afterPlace,
  dropWrite,
  footnote,
  imageErrorMessage,
  newSlot,
  prompt,
  removePageState,
  settingTags,
  slotArt,
  slotTitle,
  valueLine,
} from "./binderBuilder.ts";
import { useWideLayout } from "./useWideLayout.ts";
import styles from "./binder.module.css";

/**
 * Lay one binder out.
 *
 * A binder is a PLAN, not a second collection: it holds positions, and what you
 * own is answered by the collection at render time. That is why a card you do
 * not have can sit in a pocket and simply render shadowed, and why planning
 * around gaps — pockets kept empty on purpose, cards still being chased — is the
 * point of the screen rather than a state it tolerates.
 *
 * ## Two ways to fill it, because they are for different moments
 *
 * **Choose a pocket, then choose a card.** Works with a finger, a pointer and a
 * keyboard without three implementations, and it is what the phone layout is
 * built around. Placing advances to the next empty pocket, so a binder is filled
 * card after card rather than one card being replaced over and over.
 *
 * **Drag.** Pointer events, never HTML5 drag-and-drop — `dragstart` never fires
 * on touch. Pocket to pocket SWAPS; a card from the picker REPLACES. All of it
 * lives in `features/binders/useBinderDrag.ts`, which is shared with v1 so the
 * three traps it solves are solved once.
 *
 * ## What this screen costs
 *
 * One printings request per SET the binder spans, and the Riolu binder spans
 * thirty — thirty requests, not three hundred, because `useBinderValue` asks per
 * set rather than per card and keys its query the way `useSetPrintings` does, so
 * a set already fetched anywhere else is free. The picker adds one more for
 * whichever set is being browsed.
 *
 * Binder writes are local-first: `saveBinder` writes through to storage
 * immediately and the sync is debounced ~10s behind it, so nothing on this
 * screen waits for a network.
 */
export function BinderScreen({ binderId }: { binderId: string }) {
  const repo = useRepositories();
  const { binders, saveBinder, ownedFinishes } = useLibrary();
  const wide = useWideLayout();

  const binder = binders.find((b) => b.id === binderId) ?? null;

  /**
   * What is being filled: a pocket, or the cover.
   *
   * A tagged ADDRESS rather than `{page, index}`, since the cover became
   * fillable. A sentinel page number was the alternative and it leaks:
   * `nextEmptyPocket` and `placeSlot` both do arithmetic on `page`, and `-1` is
   * a number they would happily accept.
   */
  const [selected, setSelected] = useState<BinderAddress | null>(null);
  /**
   * The picker, open or shut.
   *
   * **Shut until it is asked for**, and asking is choosing a pocket. On a wide
   * window that is not a preference, it is arithmetic: the rail is 320px, and a
   * shut `RailHost` costs the spread nothing at all — while a shut rail still
   * held grid track, a 12-pocket page lost 33px of pocket. So the binder keeps
   * the whole shell until you want cards, and shrinking the pockets is then
   * something you did, with one press to put it back.
   */
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chosenSet, setChosenSet] = useState<{ id: string; name: string } | null>(null);
  const [searchInput, setSearchInput] = useState("");
  /** The SUBMITTED query — see BinderPicker for why typing does not search. */
  const [search, setSearch] = useState("");
  /** A search result awaiting a printing. */
  const [chosen, setChosen] = useState<PokemonCardSummary | null>(null);
  const [uploading, setUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  // ALL sets, not just collected ones: a binder is a plan, and planning a set
  // you have not started is the common case.
  const { data: sets } = useSets();
  /*
   * The picker opens on the newest set rather than on nothing. A `<select>` with
   * no value shows the first option anyway, so leaving it unset would show one
   * set's name over another set's cards.
   */
  const active = chosenSet ?? (sets?.[0] ? { id: sets[0].id, name: sets[0].name } : null);
  const view = useSetView(active?.id ?? "", active?.name ?? "", { wantPrintings: true });
  // Priced per printing, one request per SET rather than per card.
  const value = useBinderValue(binder);

  const owns = useMemo(
    () => (slot: BinderSlot) =>
      slot.kind === "image" ? true : ownedFinishes(slot.cardId).includes(slot.finish),
    [ownedFinishes],
  );

  /**
   * A drag landed. See `dropWrite` for why a move and a drop-in are different
   * writes, and why only one of them moves the selection.
   */
  const { drag, onPointerDown, consumeClick } = useBinderDrag((source, slot, to) => {
    if (!binder) return;
    const result = dropWrite(binder, source, slot, to, Date.now());
    saveBinder(result.binder);
    if (result.select) setSelected(result.select);
  });

  /**
   * Keep the pocket being filled on screen.
   *
   * The picker is a sheet over the bottom half of a phone, so the page it is
   * filling scrolls out from under it — and after a place the selection moves to
   * a pocket that may be further down still. Without this a binder is filled
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

  if (!binder) {
    return (
      <Stack gap={4}>
        <h1 className={styles.title}>Binder</h1>
        <Panel title="That binder is not here" headingLevel={2} tone="raised">
          <Stack gap={3}>
            <p className={styles.note}>
              Nothing on this device has the id <code>{binderId}</code>. It may have been deleted on another
              device — a deletion is recorded rather than merely absent, so it survives a sync.
            </p>
            <Row>
              <Card href={`#${screenToPath({ name: "binders" })}`}>Back to your binders</Card>
            </Row>
          </Stack>
        </Panel>
      </Stack>
    );
  }

  const counts = countBinder(binder);
  const facing = hasFacingPages(binder.format);
  const removePage = removePageState(binder);
  const total = valueLine(value);
  const dropTarget = drag?.over ?? null;
  const draggingFrom = drag && drag.source.kind === "address" ? addressKey(drag.source.at) : null;
  const selectedSlot = selected ? slotAt(binder, selected) : null;
  const where = !selected
    ? "the first empty pocket"
    : selected.kind === "cover"
      ? "the cover"
      : `pocket ${selected.index + 1}`;

  /**
   * Put something in the chosen slot, or empty it.
   *
   * With nothing chosen a card goes in the first empty pocket. On a wide window
   * the rail is open whether or not a pocket is chosen, so "click a card having
   * chosen nothing" is a normal thing to do rather than an impossible one, and
   * refusing it would make the rail a shop window.
   */
  const place = (slot: BinderSlot | null) => {
    const at = selected ?? (slot ? nextEmptyPocket(binder, { page: 0, index: -1 }) : null);
    if (!at) return;
    const next = putAt(binder, at, slot, Date.now());
    saveBinder(next);
    setSelected(afterPlace(next, at, slot));
    setChosen(null);
  };

  /**
   * Rewrite the chosen pocket and STAY on it.
   *
   * Counting a second copy is an edit to the pocket in front of you, not the
   * next step in filling the binder — so unlike `place` it does not advance.
   * Sharing one function would move the panel off the card still being counted.
   */
  const update = (slot: CardSlot) => {
    if (!selected) return;
    saveBinder(putAt(binder, selected, slot, Date.now()));
  };

  /**
   * Choose a pocket — or, on the click a completed drag leaves behind, do not.
   *
   * Swallowed here rather than in the hook, because it is the SELECTION that
   * must not happen. Rearranging a binder is not filling one: dropping a card
   * into pocket 5 and having the picker open on pocket 5 answers a question
   * nobody asked, and does it once per card while a page is being tidied.
   */
  const selectAt = (at: BinderAddress) => {
    if (consumeClick()) return;
    setChosen(null);
    // Read outside the updater: a setState inside another one runs twice under
    // StrictMode, and this is not a pure function of the previous value.
    const same = selected !== null && addressKey(selected) === addressKey(at);
    // Choosing a pocket IS asking for cards, so the picker comes out with it.
    // Deselecting leaves it as it is: shutting the picker because you tapped the
    // same pocket twice would take the card list away mid-fill.
    if (!same) setPickerOpen(true);
    setSelected(same ? null : at);
  };

  /**
   * Resize on the device, upload, then place the id.
   *
   * The order matters: the pocket is filled only once the server holds the
   * bytes. Placing first and uploading after would leave a pocket pointing at an
   * id that does not exist if the upload failed — and a binder that renders a
   * broken image on every other device is worse than one that says the upload
   * did not work.
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
      setImageError(imageErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  /** One of each card in the browsed set, at the printing a set binder is sleeved with. */
  const fill = () => {
    const slots = view.cards.flatMap((card) => {
      const finish = preferredFinish(view.finishesFor(card.collectorNumber, card.variants));
      return finish ? [newSlot(card, finish)] : [];
    });
    saveBinder(fillSequential(binder, slots, Date.now()));
    setSelected(null);
  };

  const picker = (
    <BinderPicker
      sets={sets}
      view={view}
      setId={active?.id ?? ""}
      onChooseSet={(id, name) => setChosenSet({ id, name })}
      searchInput={searchInput}
      onSearchInput={setSearchInput}
      search={search}
      onSearch={setSearch}
      chosen={chosen}
      onChoose={setChosen}
      ownedFinishes={ownedFinishes}
      where={where}
      selectedSlot={selectedSlot}
      price={selectedSlot ? value.priceFor(selectedSlot) : undefined}
      forTrade={Boolean(binder.forTrade)}
      canFill={view.cards.length > 0}
      uploading={uploading}
      imageError={imageError}
      onPlace={place}
      onUpdate={update}
      onClear={() => place(null)}
      onFill={fill}
      onAddImage={(file) => void addImage(file)}
      onPickPointerDown={(slot, event) => onPointerDown(event, { kind: "new" }, slot)}
      consumeClick={consumeClick}
    />
  );

  const coverPointerDown = (slot: BinderSlot, event: ReactPointerEvent) =>
    onPointerDown(event, { kind: "address", at: { kind: "cover" } }, slot);

  return (
    <Stack gap={5}>
      <header>
        <h1 className={styles.title}>{binder.name}</h1>
        <p className={styles.summary}>
          {counts.filled} / {counts.pockets} pockets filled
        </p>
      </header>

      {/* Page actions only. Everything that configures the binder itself lives
          in Settings below, because those are decided once and these are pressed
          constantly. */}
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.button}
          onClick={() => saveBinder(addPage(binder, Date.now()))}
        >
          Add page
        </button>
        {/*
          Nothing trims trailing empty pages automatically. A blank page kept on
          purpose and a blank page left over look identical, so the app cannot
          tell them apart and must not guess — and the automatic trim is what
          made "Add page" a silent no-op for as long as binders existed: it grew
          the binder and the same commit dropped the new page again.
        */}
        <button
          type="button"
          className={styles.button}
          disabled={removePage.disabled}
          title={removePage.reason}
          aria-label={removePage.disabled ? `Remove page — ${removePage.reason}` : "Remove page"}
          onClick={() => saveBinder(removeLastPage(binder, Date.now()))}
        >
          Remove page
        </button>
        <button
          type="button"
          className={pickerOpen ? `${styles.button} ${styles.buttonOn}` : styles.button}
          aria-expanded={pickerOpen}
          onClick={() => setPickerOpen((open) => !open)}
        >
          {pickerOpen ? "Hide cards" : "Cards"}
        </button>
        {/* One row of chrome, not two. The first snapshot of this screen had the
            page actions on one line and Settings on the next, using a tenth of a
            1440px window before the binder started. */}
        <button
          type="button"
          className={settingsOpen ? `${styles.button} ${styles.buttonOn}` : styles.button}
          aria-expanded={settingsOpen}
          aria-controls={SETTINGS_PANEL_ID}
          onClick={() => setSettingsOpen((open) => !open)}
        >
          Settings
        </button>
        {/* What is switched on, without opening the panel. Both change what the
            binder DOES, and a binder quietly still on offer is the one thing you
            would want to notice from out here. */}
        {settingTags(binder).map((tag) => (
          <Chip key={tag} tone="accent">
            {tag}
          </Chip>
        ))}
      </div>

      <BinderSettings binder={binder} open={settingsOpen} onSave={saveBinder} />

      {/* Live, because after a place the selection MOVES — a sighted user sees
          the ring travel and nobody else is told anything at all. */}
      <p className={styles.prompt} aria-live="polite">
        {prompt(selected)}
      </p>

      <RailHost open={wide && pickerOpen} rail={wide && pickerOpen ? picker : null} label="Cards">
        <div className={styles.pages}>
          {/*
            A format with no facing pages still has a cover — it just has nowhere
            to face, so it goes above page 1 rather than beside it. On a narrow
            window every format lands here in effect, because the spread collapses
            to one column and the leaf is its first child.
          */}
          {facing ? null : (
            <div className={styles.spread}>
              <BinderCoverLeaf
                binder={binder}
                selected={selected?.kind === "cover"}
                dropOver={dropTarget === "cover"}
                dragging={draggingFrom === "cover"}
                onSelect={() => selectAt({ kind: "cover" })}
                onPointerDown={coverPointerDown}
                side="solo"
              />
            </div>
          )}

          {pageGroups(binder.pages.length, binder.format).map((group, groupIndex) => {
            /*
             * Laid out the way a binder actually falls open: page 1 alone
             * against the inside front cover, then facing pairs. A trailing lone
             * page keeps its empty right side rather than centring — that gap is
             * where the next page goes, and the binder should look like it is
             * waiting for it.
             *
             * A 4-pocket binder has NO facing pages, and that is a real
             * difference rather than a preference: its page is two columns wide,
             * so two of them abreast are indistinguishable from one 12-pocket
             * page. See hasFacingPages.
             */
            const withCover = facing && groupIndex === 0;
            const abreast = facing && (withCover || group.length === 2);
            return (
              <div
                key={group[0]}
                className={styles.spread}
                data-abreast={abreast || undefined}
                data-spread-pages={group.length}
              >
                {withCover ? (
                  <BinderCoverLeaf
                    binder={binder}
                    selected={selected?.kind === "cover"}
                    dropOver={dropTarget === "cover"}
                    dragging={draggingFrom === "cover"}
                    onSelect={() => selectAt({ kind: "cover" })}
                    onPointerDown={coverPointerDown}
                    side="left"
                  />
                ) : null}
                {group.map((index, position) => (
                  <BinderPageView
                    key={index}
                    page={binder.pages[index]}
                    pageNumber={index + 1}
                    format={binder.format}
                    owns={owns}
                    priceFor={value.priceFor}
                    // The owner sees the same marks a recipient will, so what is
                    // laid out here is what gets sent — no separate preview to
                    // drift out of step.
                    trade={Boolean(binder.forTrade)}
                    selectedIndex={
                      selected?.kind === "pocket" && selected.page === index ? selected.index : null
                    }
                    dropTarget={dropTarget}
                    draggingFrom={draggingFrom}
                    side={!abreast ? "solo" : withCover || position === 1 ? "right" : "left"}
                    onSelect={(pocket) => selectAt({ kind: "pocket", page: index, index: pocket })}
                    onPointerDown={(pocket, slot, event) =>
                      onPointerDown(
                        event,
                        { kind: "address", at: { kind: "pocket", page: index, index: pocket } },
                        slot,
                      )
                    }
                  />
                ))}
              </div>
            );
          })}
        </div>
      </RailHost>

      <p className={styles.summary}>
        {footnote(binder, counts)}
        {" · "}
        {/*
          The total is only ever "the part we know". Saying how many pockets are
          unpriced alongside it is what keeps it from reading as the whole
          answer — stamps and promos price at nothing, and a binder of them would
          otherwise look worthless rather than unmeasured.
        */}
        <Money value={total.total} loading={total.loading} />
        {total.note ? ` (${total.note})` : ""}
      </p>

      {/* The phone counterpart of the rail: the same picker, from the bottom,
          where a thumb is. */}
      <Sheet open={!wide && pickerOpen} onClose={() => setPickerOpen(false)} label="Cards">
        {picker}
      </Sheet>

      {/*
        The card under the pointer while it is being carried.
        `pointer-events: none` in the stylesheet is not cosmetic: the hit test
        that decides where the card lands is `elementFromPoint` at the pointer,
        and a ghost that took events would be the answer to every one of those
        tests.
      */}
      {drag ? (
        <div className={styles.ghost} style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          <CardArt src={slotArt(drag.slot)} name={slotTitle(drag.slot)} detail="pocket" decorative />
        </div>
      ) : null}
    </Stack>
  );
}
