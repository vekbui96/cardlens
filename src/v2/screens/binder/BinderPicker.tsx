import type { PointerEvent as ReactPointerEvent } from "react";
import { CardArt, Chip, Row, ScreenReaderOnly, Stack, cx } from "../../primitives/index.ts";
import { useCatalogSearch } from "../../../hooks/useCatalogSearch.ts";
import type { SetView } from "../../../hooks/useSetView.ts";
import { FULL_SEARCH_LIMIT } from "../../../integrations/providers.ts";
import type { CollectFinish, PokemonCardSummary, PokemonSet } from "../../../models/cards.ts";
import type { BinderSlot, CardSlot } from "../../../models/binderLayout.ts";
import { newSlot, plural, printingLabel } from "./binderBuilder.ts";
import { PocketDetail } from "./PocketDetail.tsx";
import styles from "./binder.module.css";

/**
 * Where cards come from.
 *
 * Two ways in, because they answer different questions. **Browsing one set** is
 * how a master-set binder gets built — pick the set, then work down it, or fill
 * the whole binder with one of each in collector order. **Searching every set**
 * is the only way to reach a card whose set you do not remember; 218 sets in a
 * dropdown is not a way to find one card.
 *
 * A card from the set list can be DRAGGED into a pocket. A search result cannot,
 * and that is not an oversight: a set row names one printing, so there is a
 * finish to place, while a search result is a card whose printing has not been
 * chosen yet and dragging it would have to guess one.
 */
export function BinderPicker({
  sets,
  view,
  setId,
  onChooseSet,
  searchInput,
  onSearchInput,
  search,
  onSearch,
  chosen,
  onChoose,
  ownedFinishes,
  where,
  selectedSlot,
  price,
  forTrade,
  canFill,
  uploading,
  imageError,
  onPlace,
  onUpdate,
  onClear,
  onFill,
  onAddImage,
  onPickPointerDown,
  consumeClick,
}: {
  sets: PokemonSet[] | undefined;
  view: SetView;
  setId: string;
  onChooseSet: (id: string, name: string) => void;
  searchInput: string;
  onSearchInput: (value: string) => void;
  /** The SUBMITTED query. Typing does not search — see the form below. */
  search: string;
  onSearch: (query: string) => void;
  chosen: PokemonCardSummary | null;
  onChoose: (card: PokemonCardSummary | null) => void;
  ownedFinishes: (cardId: string) => CollectFinish[];
  where: string;
  selectedSlot: BinderSlot | null;
  price: number | undefined;
  forTrade: boolean;
  canFill: boolean;
  uploading: boolean;
  imageError: string | null;
  onPlace: (slot: CardSlot) => void;
  onUpdate: (slot: CardSlot) => void;
  onClear: () => void;
  onFill: () => void;
  onAddImage: (file: File) => void;
  onPickPointerDown: (slot: BinderSlot, event: ReactPointerEvent) => void;
  consumeClick: () => boolean;
}) {
  return (
    <div className={styles.picker}>
      <h2 className={styles.pickerTitle}>Cards</h2>

      {/*
        A submitted query, not a live one. pokemontcg.io fails in bursts and
        rate-limits, and a request per keystroke would spend that budget on
        prefixes nobody asked about.
      */}
      <form
        className={styles.searchForm}
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          onSearch(searchInput.trim());
        }}
      >
        <input
          className={styles.input}
          type="search"
          aria-label="Search every set"
          placeholder="Search every set"
          value={searchInput}
          onChange={(e) => onSearchInput(e.target.value)}
        />
        <button type="submit" className={styles.button} disabled={!searchInput.trim()}>
          Search
        </button>
        {search ? (
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              onSearch("");
              onSearchInput("");
            }}
          >
            Browse sets
          </button>
        ) : null}
      </form>

      {/*
        The whole row goes while a search is up: the select would label a list it
        is not the source of, and on a phone this row costs a row of pockets —
        which is the thing the picker exists to fill.
      */}
      {search ? null : (
        <Stack gap={2}>
          <Row gap={2} wrap>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Cards from</span>
              <select
                className={styles.select}
                value={setId}
                onChange={(e) => {
                  const next = (sets ?? []).find((s) => s.id === e.target.value);
                  onChooseSet(e.target.value, next?.name ?? e.target.value);
                }}
              >
                {(sets ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </Row>
          <Row gap={2} wrap>
            {/* One of each card, in collector order, at the printing a set
                binder is normally sleeved with. REPLACES the pages — "fill from
                this set" is a statement about the whole binder, and merging into
                whatever was there would make the result depend on history the
                user cannot see. */}
            <button type="button" className={styles.button} disabled={!canFill} onClick={onFill}>
              Fill with one of each
            </button>
            {/* A photo, a divider, a proxy — anything the catalog has no entry
                for. The file is resized on the device and stored on the server,
                so the binder carries a 20-byte id rather than a data URI it
                would re-send on every edit. */}
            <label className={cx(styles.button, uploading && styles.buttonOn)}>
              {uploading ? "Uploading…" : "Add image"}
              <ScreenReaderOnly>Add a custom image to {where}</ScreenReaderOnly>
              <input
                type="file"
                accept="image/*"
                hidden
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // Reset first: picking the same file twice in a row fires no
                  // change event otherwise, so a failed upload could not be
                  // retried without choosing a different picture.
                  e.target.value = "";
                  if (file) onAddImage(file);
                }}
              />
            </label>
          </Row>
        </Stack>
      )}

      {imageError ? (
        <p className={styles.error} role="alert">
          {imageError}
        </p>
      ) : null}

      {search ? (
        /* Keyed on the query so a new search starts at the results again rather
           than on the printings of a card the user has moved on from. */
        <SearchResults key={search} query={search} ownedFinishes={ownedFinishes} onChoose={onChoose} />
      ) : (
        <SetCards
          view={view}
          ownedFinishes={ownedFinishes}
          onPlace={onPlace}
          onPointerDown={onPickPointerDown}
          consumeClick={consumeClick}
        />
      )}

      <PocketDetail
        chosen={chosen}
        slot={selectedSlot}
        where={where}
        forTrade={forTrade}
        price={price}
        onPlace={onPlace}
        onUpdate={onUpdate}
        onClear={onClear}
        onCancel={() => onChoose(null)}
      />
    </div>
  );
}

/** One set's cards, one tile per printing — the only list you can drag from. */
function SetCards({
  view,
  ownedFinishes,
  onPlace,
  onPointerDown,
  consumeClick,
}: {
  view: SetView;
  ownedFinishes: (cardId: string) => CollectFinish[];
  onPlace: (slot: CardSlot) => void;
  onPointerDown: (slot: BinderSlot, event: ReactPointerEvent) => void;
  consumeClick: () => boolean;
}) {
  if (view.isLoading) {
    return (
      <ul className={styles.cards} aria-busy="true">
        <ScreenReaderOnly>Loading cards</ScreenReaderOnly>
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i}>
            <span className={styles.skeleton} />
          </li>
        ))}
      </ul>
    );
  }

  if (view.isError) {
    // The catalog fails roughly a quarter of the time, in bursts. A retry is
    // the whole remedy, so it is offered here rather than as an apology.
    return (
      <Stack gap={2}>
        <p className={styles.note} role="alert">
          That set’s cards could not be loaded. The binder itself is safe on this device.
        </p>
        <Row>
          <Chip onPress={view.refetch}>Try again</Chip>
        </Row>
      </Stack>
    );
  }

  if (view.cards.length === 0) {
    return (
      <p className={styles.note}>The catalog has nothing indexed for this set. Try another, or search.</p>
    );
  }

  return (
    <ul className={styles.cards}>
      {view.cards.flatMap((card) => {
        const finishes = view.finishesFor(card.collectorNumber, card.variants);
        const held = ownedFinishes(card.id);
        return (finishes.length > 0 ? finishes : held).map((finish) => {
          const owned = held.includes(finish);
          // Built ONCE, because the click and the drag place the identical slot
          // — two copies of this object is how they come to disagree.
          const slot = newSlot(card, finish);
          return (
            <li key={`${card.id}:${finish}`}>
              <button
                type="button"
                className={styles.pick}
                aria-label={printingLabel(card, finish, owned)}
                onClick={() => {
                  // A drag that started here has already placed the card.
                  if (consumeClick()) return;
                  onPlace(slot);
                }}
                onPointerDown={(event) => onPointerDown(slot, event)}
              >
                <CardArt
                  src={card.imageSmall}
                  name={card.name}
                  detail="tile"
                  decorative
                  className={owned ? undefined : styles.wanted}
                />
                <span className={styles.pickMeta}>{card.collectorNumber}</span>
              </button>
            </li>
          );
        });
      })}
    </ul>
  );
}

/**
 * Find a card without knowing which set it is in.
 *
 * Two taps rather than one, because a result carries no trustworthy printing
 * list: pick the card, then pick the printing below, once the oracle has
 * answered for that card's set alone.
 */
function SearchResults({
  query,
  ownedFinishes,
  onChoose,
}: {
  query: string;
  ownedFinishes: (cardId: string) => CollectFinish[];
  onChoose: (card: PokemonCardSummary) => void;
}) {
  // Every printing of that Pokémon, not the top 40. The short list is right for
  // a focus ring on the glasses and wrong here: "where does my Charizard go" is
  // a question about the 108 that exist, and the one you mean is rarely in the
  // first handful.
  const { data, isLoading, isError, refetch } = useCatalogSearch(query, undefined, { full: true });

  if (isLoading) return <p className={styles.note}>Searching…</p>;

  if (isError) {
    return (
      <Stack gap={2}>
        <p className={styles.note} role="alert">
          That search could not be run. The catalog fails in bursts; trying again usually works.
        </p>
        <Row>
          <Chip onPress={() => refetch()}>Try again</Chip>
        </Row>
      </Stack>
    );
  }

  const results = data ?? [];
  if (results.length === 0) {
    return <p className={styles.note}>No cards match “{query}”. Check the spelling, or search by Pokémon.</p>;
  }

  return (
    <Stack gap={2}>
      <p className={styles.note}>
        {plural(results.length, "card")} match “{query}”, closest match first.
        {/* A full page back is indistinguishable from a complete answer, so say
            which one this is rather than implying the catalog stops there. */}
        {results.length >= FULL_SEARCH_LIMIT ? " That is the first page — add a word to narrow it." : ""}
      </p>
      <ul className={styles.cards}>
        {results.map((card) => {
          const owned = ownedFinishes(card.id).length > 0;
          return (
            <li key={card.id}>
              <button
                type="button"
                className={styles.pick}
                aria-label={`${card.name}, ${card.collectorNumber}, ${card.setName}, ${owned ? "owned" : "not owned"}`}
                onClick={() => onChoose(card)}
              >
                <CardArt
                  src={card.imageSmall}
                  name={card.name}
                  detail="tile"
                  decorative
                  className={owned ? undefined : styles.wanted}
                />
                {/* Two lines, not one: a result's set is what tells two
                    otherwise identical Charizards apart, and squeezed onto the
                    number's line it is the half that gets ellipsised. */}
                <span className={styles.pickMeta}>{card.collectorNumber}</span>
                <span className={styles.pickMeta}>{card.setName}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Stack>
  );
}
