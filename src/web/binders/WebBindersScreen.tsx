import { useMemo, useState, type FormEvent } from "react";
import { useBindersValue } from "../../hooks/useBindersValue.ts";
import type { BinderValueSummary } from "../../models/binderValue.ts";
import { formatUsd } from "../../utils/format.ts";
import { Screen } from "../../components/Screen.tsx";
import { BackRow } from "../../components/BackRow.tsx";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useLibrary } from "../../app/LibraryProvider.tsx";
import {
  BINDER_FORMATS,
  countBinder,
  emptyBinder,
  specFor,
  type Binder,
  type BinderFormat,
  type BinderSlot,
} from "../../models/binderLayout.ts";
import { BinderCover } from "./BinderCover.tsx";
import styles from "./WebBindersScreen.module.css";

/**
 * A binder's total, on its tile.
 *
 * "Pricing…" rather than a blank or a zero while the sets answer: a total that
 * appears out of nothing looks like a number that changed, and $0.00 is the one
 * thing this figure must never say when it simply does not know yet.
 */
function BinderTotal({ summary, loading }: { summary?: BinderValueSummary; loading: boolean }) {
  if (!summary || (loading && summary.priced === 0)) {
    return <span className={styles.valuePending}>Pricing…</span>;
  }
  return (
    <span className={styles.value}>
      {formatUsd(summary.total)}
      {summary.unpriced > 0 ? <span className={styles.valueNote}> · {summary.unpriced} unpriced</span> : null}
    </span>
  );
}

/**
 * Ids must be unique across DEVICES, not just this one, because they are the
 * key binders converge on: two phones that both minted "b1" would merge into
 * one binder and the older arrangement would vanish. The clock alone is not
 * enough — two devices creating a binder in the same millisecond is unlikely
 * but the failure is silent and permanent — so it carries randomness too.
 */
function newId(): string {
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * One binder on the shelf.
 *
 * A tile rather than a row, and the change is not decoration. The row design
 * gave a binder 56px of height and spent all of it on words, so six binders
 * read as six identical grey bars and the only way to find one was to read the
 * names in order. The cover answers that at a glance — and it is free, because
 * the art is already in the binder (see BinderCover).
 *
 * The delete control is a sibling of the open button rather than inside it: a
 * button cannot contain a button, and putting the destructive action inside the
 * thing you press to open the binder is how it got pressed by accident.
 */
function BinderTile({
  binder,
  owns,
  summary,
  valuesLoading,
  onOpen,
  onDelete,
}: {
  binder: Binder;
  owns: (slot: BinderSlot) => boolean;
  summary?: BinderValueSummary;
  valuesLoading: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  /**
   * Deleting takes two presses, and the second one is on a different button.
   *
   * A binder is pages of arrangement that took an evening to build and there is
   * no undo — the delete writes a tombstone precisely so the deletion SURVIVES
   * a sync, which means a misclick propagates to every device. The old design
   * had a bare red "Delete" sitting next to the name on every row.
   */
  const [confirming, setConfirming] = useState(false);
  const counts = countBinder(binder);
  const spec = specFor(binder.format);
  const filledPct = counts.pockets > 0 ? Math.round((counts.filled / counts.pockets) * 100) : 0;
  const complete = counts.pockets > 0 && counts.filled === counts.pockets;

  return (
    <li className={styles.tile}>
      <button type="button" className={styles.open} onClick={onOpen}>
        <span className={styles.coverFrame}>
          <BinderCover binder={binder} owns={owns} />
        </span>

        <span className={styles.name}>
          {binder.name}
          {/* A binder that is on offer looked like any other in this list, and
              "which one did I mark for trade" is the question the list exists to
              answer at a glance. */}
          {binder.forTrade ? <span className={styles.tradeTag}>For trade</span> : null}
        </span>

        {/*
         * The fill, as a bar and as a number.
         *
         * The number alone was there before and it is the wrong shape for the
         * question: "107/168" has to be divided in your head, and four binders'
         * worth of that is the reason nobody read the meta line. The bar is
         * read by length, the number is read when you care about the exact
         * figure, and neither is decoration for the other.
         */}
        <span className={styles.meter} aria-hidden="true">
          <span
            className={`${styles.meterFill} ${complete ? styles.meterFull : ""}`}
            style={{ width: `${filledPct}%` }}
          />
        </span>

        {/*
         * Two lines by design, rather than one that wraps.
         *
         * "167/168 · 12-pocket · 14 pages" does not fit a tile at any of the
         * three column counts, so it wrapped — and where it broke depended on
         * the name above it, which made a row of tiles ragged for no reason.
         * Splitting it is also the better reading: the first line is how full
         * the binder is, which is what you scan down the shelf for, and the
         * second is what shape it is, which you look at once.
         */}
        <span className={styles.count}>
          {counts.filled}/{counts.pockets}
        </span>
        <span className={styles.meta}>
          {spec.label} · {binder.pages.length} page{binder.pages.length === 1 ? "" : "s"}
          {/* Copies only diverge from pockets in a trade binder, so the figure
              only appears where it means something. */}
          {binder.forTrade && counts.copies !== counts.cards ? ` · ${counts.copies} cards` : ""}
        </span>

        {/* The headline figure, for binders that asked for one. The unpriced
            count rides with it rather than being dropped: whole sets have no
            market price, and a total that hid that would read as the whole
            answer. */}
        {binder.showValue ? <BinderTotal summary={summary} loading={valuesLoading} /> : null}
      </button>

      {confirming ? (
        <div className={styles.confirm} role="group" aria-label={`Delete ${binder.name}?`}>
          <p className={styles.confirmText}>Delete “{binder.name}”?</p>
          <div className={styles.confirmActions}>
            <button
              type="button"
              className={styles.confirmNo}
              onClick={() => setConfirming(false)}
              aria-label={`Keep ${binder.name}`}
            >
              Keep
            </button>
            <button
              type="button"
              className={styles.confirmYes}
              onClick={onDelete}
              aria-label={`Confirm delete ${binder.name}`}
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={styles.remove}
          onClick={() => setConfirming(true)}
          aria-label={`Delete ${binder.name}`}
        >
          {/* A glyph, not the word: the word "Delete" in red was the second
              loudest thing on a screen whose subject is the binders. */}
          <span aria-hidden="true">✕</span>
        </button>
      )}
    </li>
  );
}

/**
 * Your binders.
 *
 * A binder is a layout, not a second collection: it holds positions, and what
 * you own is answered by the collection at render time. That is why a card you
 * do not have can sit in a pocket and simply render shadowed — the binder is a
 * plan, and planning around gaps is the point.
 *
 * The screen is a shelf. Creating a binder is the last tile on it rather than a
 * form across the top, because the ratio is not close: a binder is created once
 * and opened for weeks, and the old layout gave the rarer action an empty text
 * field, three chips and a disabled button above everything else, every visit.
 */
export function WebBindersScreen() {
  const { pop, push } = useNavigation();
  const { binders, saveBinder, deleteBinder, ownedFinishes } = useLibrary();
  const [name, setName] = useState("");
  const [format, setFormat] = useState<BinderFormat>("9");

  /**
   * Only the binders that asked to be priced.
   *
   * Filtered HERE rather than inside the hook so the cost is visible at the
   * call site: each binder in this list is a request per set it spans, and this
   * screen makes none otherwise.
   */
  const priced = useMemo(() => binders.filter((b) => b.showValue), [binders]);
  const values = useBindersValue(priced);

  /**
   * Ownership, for the cover shading. A local map lookup per pocket, no fetch.
   *
   * An image slot is always "held": it is a photo or a divider the owner put
   * there, not a printing the collection could have an opinion about.
   */
  const owns = useMemo(
    () => (slot: BinderSlot) =>
      slot.kind === "image" ? true : ownedFinishes(slot.cardId).includes(slot.finish),
    [ownedFinishes],
  );

  /**
   * What the shelf holds, in the header.
   *
   * Pockets rather than binders is the figure that grows: six binders is a
   * number that stops meaning anything, and the cards are the collection.
   */
  const total = useMemo(() => binders.reduce((sum, b) => sum + countBinder(b).copies, 0), [binders]);

  const create = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const binder = emptyBinder(newId(), trimmed, format, Date.now());
    saveBinder(binder);
    setName("");
    push({ name: "binder", binderId: binder.id });
  };

  return (
    <Screen
      title="Binders"
      headerLeft={<BackRow focused={false} onActivate={pop} />}
      headerRight={
        binders.length > 0
          ? `${binders.length} binder${binders.length === 1 ? "" : "s"} · ${total} cards`
          : undefined
      }
      canGoBack
    >
      <ul className={styles.shelf}>
        {binders.map((binder) => (
          <BinderTile
            key={binder.id}
            binder={binder}
            owns={owns}
            summary={values.byId.get(binder.id)}
            valuesLoading={values.isLoading}
            onOpen={() => push({ name: "binder", binderId: binder.id })}
            onDelete={() => deleteBinder(binder.id)}
          />
        ))}

        {/*
         * The empty slot on the shelf.
         *
         * Last, and shaped like a binder, so it reads as "one more goes here"
         * rather than as a settings panel. With no binders at all it is the only
         * tile on the screen and needs no separate empty state — which is why
         * the old "No binders yet" notice is gone: it sat UNDER the form that
         * answered it.
         */}
        <li className={`${styles.tile} ${styles.createTile}`}>
          <form className={styles.create} onSubmit={create}>
            <p className={styles.createTitle}>New binder</p>
            <input
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name it"
              aria-label="Binder name"
            />
            <div className={styles.formats} role="group" aria-label="Binder format">
              {BINDER_FORMATS.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`${styles.chip} ${format === f ? styles.chipOn : ""}`}
                  aria-pressed={format === f}
                  onClick={() => setFormat(f)}
                >
                  {specFor(f).label}
                </button>
              ))}
            </div>
            <button type="submit" className={styles.primary} disabled={!name.trim()}>
              Create binder
            </button>
          </form>
        </li>
      </ul>
    </Screen>
  );
}
