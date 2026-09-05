import { useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CardArt, Chip, Row, ScreenReaderOnly, Stack, cx } from "../../primitives/index.ts";
import { useLibrary } from "../../../app/LibraryProvider.tsx";
import { useRepositories } from "../../../app/contexts.tsx";
import { useSets } from "../../../hooks/useSets.ts";
import { useSetView, type SetView } from "../../../hooks/useSetView.ts";
import { useSetPrintings } from "../../../hooks/useSetPrintings.ts";
import { useCatalogSearch } from "../../../hooks/useCatalogSearch.ts";
import { availableFinishes, type CollectFinish, type PokemonCardSummary } from "../../../models/cards.ts";
import { finishLabel } from "../../../models/finishes.ts";
import {
  conditionLabel,
  preferredFinish,
  slotQuantity,
  TRADE_CONDITIONS,
  withCondition,
  withQuantity,
  type BinderAddress,
  type BinderSlot,
  type CardSlot,
} from "../../../models/binderLayout.ts";
import { setIdFromCardId } from "../../../utils/cardId.ts";
import { formatUsd } from "../../../utils/format.ts";
import { resizeToDataUrl } from "../../../utils/imageResize.ts";
import { uploadBinderImage } from "../../../services/sync/binderImages.ts";
import { SyncAuthError, SyncDisabledError, SyncTooLargeError } from "../../../services/sync/http.ts";
import { addressPhrase, slotName } from "./pocketText.ts";
import styles from "./binder.module.css";

/**
 * Where cards come from.
 *
 * The same contents whether it is a rail on a desktop or a sheet on a phone —
 * the container is the caller's choice, because only the caller knows whether
 * this survives being 320px wide. It is mounted only while it is OPEN, which is
 * the request budget: `useSetView` costs a set, and a rail that is shut until
 * asked for should cost nothing at all.
 *
 * Three ways in, because they answer different questions. SEARCH finds a card
 * whose set you do not remember — 218 sets in a dropdown is not a way to find
 * one card. BROWSE fills a binder from one set, which is how a master set gets
 * built. ADD IMAGE covers everything the catalog has no entry for.
 */
export interface BinderPickerProps {
  /** Which pocket is being filled, for the wording. Null means "the first empty one". */
  selected: BinderAddress | null;
  /** What that pocket already holds, so it can be counted, graded or cleared. */
  selectedSlot: BinderSlot | null;
  forTrade: boolean;
  /** Place into the selected pocket, or clear it with `null`. */
  onPlace: (slot: BinderSlot | null) => void;
  /** Rewrite the selected pocket WITHOUT advancing — copies and grade. */
  onUpdate: (slot: CardSlot) => void;
  /** Replace every page with one of each card in the browsed set. */
  onFill: (slots: BinderSlot[]) => void;
  /** Start a drag from a picker tile. The slot is not in the binder yet. */
  onDragNew: (event: ReactPointerEvent, slot: BinderSlot) => void;
  /** True for the click a completed drag leaves behind — it has already placed. */
  consumeClick: () => boolean;
  priceFor: (slot: BinderSlot) => number | undefined;
  headingLevel?: 2 | 3;
}

export function BinderPicker({
  selected,
  selectedSlot,
  forTrade,
  onPlace,
  onUpdate,
  onFill,
  onDragNew,
  consumeClick,
  priceFor,
  headingLevel = 2,
}: BinderPickerProps) {
  const { ownedFinishes } = useLibrary();
  const { data: allSets } = useSets();

  const [setId, setSetId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  /**
   * The SUBMITTED query. Typing does not search: pokemontcg.io fails in bursts
   * and rate-limits, and a request per keystroke would spend that budget on
   * prefixes nobody asked about.
   */
  const [search, setSearch] = useState("");
  /**
   * A search result awaiting a printing. Held here rather than in the results
   * list, so the question can sit BELOW the list while the list stays on screen
   * — choosing between a card's printings is a comparison, and swapping the
   * results out removes what it is against.
   */
  const [chosen, setChosen] = useState<PokemonCardSummary | null>(null);

  // ALL sets, not just collected ones: a binder is a plan, and planning a set
  // you have not started is the common case.
  const browsing = (allSets ?? []).find((s) => s.id === setId) ?? (allSets ?? [])[0];
  const view = useSetView(browsing?.id ?? "", browsing?.name ?? "", {
    rarities: null,
    wantPrintings: true,
  });

  const Heading = `h${headingLevel}` as const;
  const where = selected ? addressPhrase(selected) : "the first empty pocket";

  return (
    <Stack gap={3}>
      <Heading className={styles.hint}>
        <ScreenReaderOnly>Cards. </ScreenReaderOnly>
        {selected
          ? `Filling ${where}.`
          : "A card clicked with nothing selected goes in the first empty pocket."}
      </Heading>

      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(searchInput.trim());
          setChosen(null);
        }}
      >
        <Row gap={2}>
          <input
            className={styles.input}
            type="search"
            aria-label="Search every set"
            placeholder="Search every set"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <button type="submit" className={styles.button} disabled={!searchInput.trim()}>
            Search
          </button>
          {search ? (
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                setSearch("");
                setSearchInput("");
                setChosen(null);
              }}
            >
              Browse sets
            </button>
          ) : null}
        </Row>
      </form>

      {/* The whole row goes while a search is up: the select would label a list
          it is not the source of, and on a phone this row costs a row of
          pockets — which is the thing the picker exists to fill. */}
      {search ? null : (
        <BrowseRow
          sets={allSets ?? []}
          value={browsing?.id ?? ""}
          onChange={setSetId}
          onFill={() => onFill(fillSlots(view))}
          canFill={view.cards.length > 0}
          onPlace={onPlace}
        />
      )}

      {search ? (
        <SearchResults key={search} query={search} onChoose={setChosen} ownedFinishes={ownedFinishes} />
      ) : (
        <SetCards
          view={view}
          ownedFinishes={ownedFinishes}
          onPlace={onPlace}
          onDragNew={onDragNew}
          consumeClick={consumeClick}
        />
      )}

      {/* Last, so "which printing" is asked where the thumb already is, under
          the list it was asked about — and so a filled pocket can be marked
          owned without finding the card in the catalog a second time. */}
      <PocketDetail
        chosen={chosen}
        slot={selectedSlot}
        where={where}
        forTrade={forTrade}
        priceFor={priceFor}
        onPlace={onPlace}
        onUpdate={onUpdate}
        onCancel={() => setChosen(null)}
      />
    </Stack>
  );
}

/* --- Browsing one set ----------------------------------------------------- */

/**
 * One printing of each card in the set, in collector order.
 *
 * Reverse holo first — see `preferredFinish`. Cards with no printing at all are
 * dropped rather than guessed at.
 */
function fillSlots(view: SetView): BinderSlot[] {
  return view.cards.flatMap((card) => {
    const finish = preferredFinish(view.finishesFor(card.collectorNumber, card.variants));
    if (!finish) return [];
    return [
      {
        kind: "card" as const,
        cardId: card.id,
        finish,
        name: card.name,
        ...(card.imageSmall ? { imageSmall: card.imageSmall } : {}),
        collectorNumber: card.collectorNumber,
      },
    ];
  });
}

function BrowseRow({
  sets,
  value,
  onChange,
  onFill,
  canFill,
  onPlace,
}: {
  sets: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
  onFill: () => void;
  canFill: boolean;
  onPlace: (slot: BinderSlot | null) => void;
}) {
  return (
    <Stack gap={2}>
      <Row gap={2} wrap>
        <label className={styles.hint}>
          Cards from{" "}
          <select className={styles.select} value={value} onChange={(e) => onChange(e.target.value)}>
            {sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {/* One of each card, in collector order, at the printing a set binder is
            normally sleeved with. REPLACES the pages — see fillSequential. */}
        <button type="button" className={styles.button} disabled={!canFill} onClick={onFill}>
          Fill with one of each
        </button>
        <AddImage onPlace={onPlace} />
      </Row>
    </Stack>
  );
}

/* --- Custom art ----------------------------------------------------------- */

/**
 * Say what actually went wrong.
 *
 * One "could not add image" would collapse four different situations — a
 * rejected token, sync switched off at the server, a file too large, and no
 * connection — into a message that tells the user nothing about which to fix.
 */
function imageErrorMessage(err: unknown): string {
  if (err instanceof SyncAuthError) return "The server rejected this device's sync token.";
  if (err instanceof SyncDisabledError) return "The server has sync switched off, so it cannot hold images.";
  if (err instanceof SyncTooLargeError) return "That image is too large, even after resizing.";
  if (err instanceof Error && err.message) return err.message;
  return "Could not reach the server to store that image.";
}

/**
 * A photo, a divider, a proxy — anything the catalog has no entry for.
 *
 * Resized on the device and stored on the server, so the binder carries a
 * 20-byte id rather than a data URI it would re-send on every edit. The order
 * matters: the pocket is only filled once the server holds the bytes, because a
 * pocket pointing at an id that does not exist renders as a broken image on
 * every other device.
 */
function AddImage({ onPlace }: { onPlace: (slot: BinderSlot | null) => void }) {
  const repo = useRepositories();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async (file: File) => {
    setError(null);
    const token = repo.getSyncSettings().token;
    if (!token) {
      setError("Connect this device to the server first — custom images are stored there, not here.");
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await resizeToDataUrl(file);
      const imageId = await uploadBinderImage(token, dataUrl);
      onPlace({ kind: "image", imageId, label: file.name.replace(/\.[^.]+$/, "").slice(0, 120) });
    } catch (err) {
      setError(imageErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <label className={cx(styles.button, styles.fileLabel)}>
        {uploading ? "Uploading…" : "Add image"}
        <input
          type="file"
          // SVG is refused: it is a script container, and these are served back
          // from the user's own origin.
          accept="image/png,image/jpeg,image/webp,image/gif"
          className={styles.fileInput}
          aria-label="Add image"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Reset first: picking the same file twice in a row fires no change
            // event otherwise, so a failed upload could not be retried without
            // choosing a different picture.
            e.target.value = "";
            if (file) void add(file);
          }}
        />
      </label>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

/* --- The card lists ------------------------------------------------------- */

function SetCards({
  view,
  ownedFinishes,
  onPlace,
  onDragNew,
  consumeClick,
}: {
  view: SetView;
  ownedFinishes: (cardId: string) => CollectFinish[];
  onPlace: (slot: BinderSlot | null) => void;
  onDragNew: (event: ReactPointerEvent, slot: BinderSlot) => void;
  consumeClick: () => boolean;
}) {
  if (view.isLoading) {
    return (
      <ul className={styles.pickerCards} aria-busy="true">
        <ScreenReaderOnly>Loading cards</ScreenReaderOnly>
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <li key={n} className={styles.skeletonTile} />
        ))}
      </ul>
    );
  }

  if (view.isError) {
    // The catalog fails in bursts, and a retry is the whole remedy — so it is
    // offered inline rather than as an apology.
    return (
      <Stack gap={2}>
        <p className={styles.error} role="alert">
          Could not reach the card catalog.
        </p>
        <Row gap={2}>
          <button type="button" className={styles.button} onClick={() => view.refetch()}>
            Try again
          </button>
        </Row>
      </Stack>
    );
  }

  if (view.cards.length === 0) {
    return <p className={styles.hint}>No cards in this set yet. Try another, or search by name.</p>;
  }

  return (
    <ul className={styles.pickerCards}>
      {view.cards.flatMap((card) => {
        const finishes = view.finishesFor(card.collectorNumber, card.variants);
        const held = ownedFinishes(card.id);
        return (finishes.length > 0 ? finishes : held).map((finish) => {
          const owned = held.includes(finish);
          // Built once: the click and the drag place the identical slot, and
          // two copies of this object is how they come to disagree on a field.
          const slot: BinderSlot = {
            kind: "card",
            cardId: card.id,
            finish,
            name: card.name,
            ...(card.imageSmall ? { imageSmall: card.imageSmall } : {}),
            collectorNumber: card.collectorNumber,
          };
          return (
            <li key={`${card.id}:${finish}`}>
              <button
                type="button"
                className={cx(styles.pickerTile, !owned && styles.pickerTileWanted)}
                aria-label={`${card.name}, ${card.collectorNumber}, ${finishLabel(finish)}, ${
                  owned ? "owned" : "not owned"
                }`}
                onClick={() => {
                  // A drag that started here has already placed the card.
                  if (consumeClick()) return;
                  onPlace(slot);
                }}
                /* Draggable straight into a pocket. Only from THIS list and not
                   from the name search: a set row names one printing, so there
                   is a finish to place, while a search result is a card whose
                   printing has not been chosen yet. */
                onPointerDown={(event) => onDragNew(event, slot)}
              >
                <CardArt
                  src={card.imageSmall}
                  name={card.name}
                  detail="tile"
                  decorative
                  className={styles.art}
                />
                <span className={styles.pickerMeta}>
                  {card.collectorNumber} · {finishLabel(finish)}
                </span>
              </button>
            </li>
          );
        });
      })}
    </ul>
  );
}

function SearchResults({
  query,
  onChoose,
  ownedFinishes,
}: {
  query: string;
  onChoose: (card: PokemonCardSummary) => void;
  ownedFinishes: (cardId: string) => CollectFinish[];
}) {
  // Every printing of that Pokémon, not the top 40. "Where does my Charizard
  // go" is a question about the 108 that exist, and the one you mean is rarely
  // in the first handful.
  const { data, isLoading, isError, refetch } = useCatalogSearch(query, undefined, { full: true });

  if (isLoading) return <p className={styles.hint}>Searching…</p>;

  if (isError) {
    return (
      <Stack gap={2}>
        <p className={styles.error} role="alert">
          Search failed.
        </p>
        <Row gap={2}>
          <button type="button" className={styles.button} onClick={() => refetch()}>
            Try again
          </button>
        </Row>
      </Stack>
    );
  }

  const results = data ?? [];
  if (results.length === 0) {
    return <p className={styles.hint}>No cards match “{query}”. Check the spelling, or search by Pokémon.</p>;
  }

  return (
    <ul className={styles.pickerCards}>
      {results.map((card) => {
        const owned = ownedFinishes(card.id).length > 0;
        return (
          <li key={card.id}>
            <button
              type="button"
              className={cx(styles.pickerTile, !owned && styles.pickerTileWanted)}
              aria-label={`${card.name}, ${card.collectorNumber}, ${card.setName}, ${
                owned ? "owned" : "not owned"
              }`}
              onClick={() => onChoose(card)}
            >
              <CardArt
                src={card.imageSmall}
                name={card.name}
                detail="tile"
                decorative
                className={styles.art}
              />
              <span className={styles.pickerMeta}>{card.collectorNumber}</span>
              <span className={styles.pickerMeta}>{card.setName}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* --- The pocket being filled ---------------------------------------------- */

/**
 * "I own this" for one printing, wherever a printing is on screen.
 *
 * It writes to the COLLECTION, not to the binder: a binder is an arrangement
 * and says nothing about ownership. That is why an unowned card can sit in a
 * pocket at all, and why this toggle changes the shading rather than the slot.
 */
function OwnToggle({ cardId, finish }: { cardId: string; finish: CollectFinish }) {
  const { isOwnedFinish, toggleOwned } = useLibrary();
  const owned = isOwnedFinish(cardId, finish);
  return (
    <Chip
      onPress={() => toggleOwned(cardId, finish, setIdFromCardId(cardId))}
      pressed={owned}
      tone={owned ? "accent" : "default"}
      label={`Own ${finishLabel(finish)}`}
    >
      {owned ? "✓ Own" : "Own"}
    </Chip>
  );
}

function PocketDetail({
  chosen,
  slot,
  where,
  forTrade,
  priceFor,
  onPlace,
  onUpdate,
  onCancel,
}: {
  chosen: PokemonCardSummary | null;
  slot: BinderSlot | null;
  where: string;
  forTrade: boolean;
  priceFor: (slot: BinderSlot) => number | undefined;
  onPlace: (slot: BinderSlot | null) => void;
  onUpdate: (slot: CardSlot) => void;
  onCancel: () => void;
}) {
  const { data: allSets } = useSets();
  const card = slot?.kind === "card" ? slot : null;
  const cardId = chosen?.id ?? card?.cardId ?? "";
  const { index, isLoading } = useSetPrintings(
    setIdFromCardId(cardId),
    chosen?.setName ?? "",
    Boolean(chosen),
  );
  const known = index?.byNumber[chosen?.collectorNumber ?? ""];

  /**
   * Which set a placed card came from.
   *
   * A slot stores the id, number, name and art but NOT the set — the
   * denormalised fields exist to paint the page offline, and a set name is not
   * needed for that. It is needed the moment you tap the pocket and ask "which
   * Riolu is this": a binder like this holds four cards numbered 17, from four
   * different sets. Recovered from the id, so every binder already in the wild
   * gains it without a migration.
   */
  const placedSetName = useMemo(
    () => (card ? (allSets ?? []).find((s) => s.id === setIdFromCardId(card.cardId))?.name : undefined),
    [allSets, card],
  );

  if (chosen) {
    /**
     * Falls back to what the pricing payload implies while the oracle answers.
     * That fallback is a guess — pokemontcg.io reports no variants at all for
     * whole sets — so it only decides which buttons to offer. The user picks,
     * and a pocket is a layout rather than a claim of ownership.
     */
    const finishes = known?.length ? known : availableFinishes(chosen.variants);
    return (
      <Stack gap={2}>
        <Row gap={2} justify="space-between">
          <span className={styles.hint}>
            {isLoading && !known?.length ? "Checking printings…" : `Which printing goes in ${where}?`}
          </span>
          <button type="button" className={styles.button} onClick={onCancel}>
            Back
          </button>
        </Row>
        <p className={styles.hint}>
          {chosen.name} · {chosen.setName} · {chosen.collectorNumber}
        </p>
        <Stack gap={2}>
          {finishes.map((finish) => (
            <Row key={finish} gap={2}>
              <button
                type="button"
                className={styles.button}
                onClick={() =>
                  onPlace({
                    kind: "card",
                    cardId: chosen.id,
                    finish,
                    // Denormalised so the page renders offline and before the
                    // catalog answers.
                    name: chosen.name,
                    ...(chosen.imageSmall ? { imageSmall: chosen.imageSmall } : {}),
                    collectorNumber: chosen.collectorNumber,
                  })
                }
              >
                {finishLabel(finish)}
              </button>
              <OwnToggle cardId={chosen.id} finish={finish} />
            </Row>
          ))}
        </Stack>
      </Stack>
    );
  }

  if (!slot) return null;

  // Custom art has no catalog entry, so there is nothing to own — but it must
  // still be clearable, or a photo would be the one thing a pocket could not be
  // emptied of.
  if (!card) {
    return (
      <Row gap={2} justify="space-between">
        <span className={styles.hint}>
          {slotName(slot)} in {where}
        </span>
        <button type="button" className={styles.button} onClick={() => onPlace(null)}>
          Clear
        </button>
      </Row>
    );
  }

  return (
    <Stack gap={2}>
      <Row gap={2} wrap>
        <span className={styles.hint}>
          {card.name ?? card.cardId} · {placedSetName ?? "Unknown set"} ·{" "}
          {card.collectorNumber ? `${card.collectorNumber} · ` : ""}
          {finishLabel(card.finish)} · {formatUsd(priceFor(card))}
        </span>
        <OwnToggle cardId={card.cardId} finish={card.finish} />
        <button type="button" className={styles.button} onClick={() => onPlace(null)}>
          Clear
        </button>
      </Row>
      {forTrade ? <TradeControls card={card} onUpdate={onUpdate} priceFor={priceFor} /> : null}
    </Stack>
  );
}

/**
 * How many, and in what shape — the two things a trade is actually about.
 *
 * Only on a binder marked for trade. On any other binder a pocket holds one
 * card because that is what a pocket is, and "how many?" has no meaning there.
 */
function TradeControls({
  card,
  onUpdate,
  priceFor,
}: {
  card: CardSlot;
  onUpdate: (slot: CardSlot) => void;
  priceFor: (slot: BinderSlot) => number | undefined;
}) {
  const copies = slotQuantity(card);
  const unit = priceFor(card);

  return (
    <Stack gap={2}>
      <Row gap={2} wrap>
        <span className={styles.hint} id="v2-copies-label">
          Copies
        </span>
        {/* A stepper, not a number field. A phone keyboard over a sheet pinned
            to the bottom covers the thing being counted, and the answer is
            almost always within a tap or two of one. */}
        <Row gap={1} as="span">
          <button
            type="button"
            className={styles.button}
            aria-label="One fewer copy"
            disabled={copies <= 1}
            onClick={() => onUpdate(withQuantity(card, copies - 1))}
          >
            −
          </button>
          <span aria-live="polite">{copies}</span>
          <button
            type="button"
            className={styles.button}
            aria-label="One more copy"
            onClick={() => onUpdate(withQuantity(card, copies + 1))}
          >
            +
          </button>
        </Row>
        {/* What the stack is worth, which is the number the owner is deciding
            against — the pocket badge shows the price of one. */}
        {copies > 1 && unit !== undefined ? (
          <span className={styles.hint}>{formatUsd(unit * copies)} total</span>
        ) : null}
      </Row>

      <Row gap={2} wrap>
        <span className={styles.hint} id="v2-condition-label">
          Condition
        </span>
        {TRADE_CONDITIONS.map((grade) => {
          const on = card.condition === grade;
          return (
            <Chip
              key={grade}
              // Pressing the grade a card already has clears it. Unstated is a
              // real answer and has to be reachable again — it is not the same
              // claim as "near mint".
              onPress={() => onUpdate(withCondition(card, on ? null : grade))}
              pressed={on}
              tone={on ? "accent" : "default"}
              label={conditionLabel(grade)}
            >
              {grade}
            </Chip>
          );
        })}
      </Row>

      <p className={styles.hint}>
        Condition is shown to whoever opens the link. It never changes the price — the market price is for the
        card, and what a played copy is worth is yours to agree.
      </p>
    </Stack>
  );
}
