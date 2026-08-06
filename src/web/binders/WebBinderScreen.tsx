import { useMemo, useState } from "react";
import { Screen } from "../../components/Screen.tsx";
import { BackRow } from "../../components/BackRow.tsx";
import { CardImage } from "../../components/CardImage.tsx";
import { BinderPageView } from "../../components/BinderPage.tsx";
import { useSets } from "../../hooks/useSets.ts";
import { useSetView } from "../../hooks/useSetView.ts";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useLibrary } from "../../app/LibraryProvider.tsx";
import { useRepositories } from "../../app/contexts.tsx";
import {
  countBinder,
  fillSequential,
  placeSlot,
  preferredFinish,
  reformat,
  specFor,
  trimPages,
  type BinderFormat,
  type BinderSlot,
} from "../../models/binderLayout.ts";
import { finishLabel } from "../../models/finishes.ts";
import styles from "./WebBinderScreen.module.css";

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
  const { ownedFinishes } = useLibrary();

  const [binders, setBinders] = useState(() => repo.getBinders());
  const binder = binders.find((b) => b.id === binderId) ?? null;

  const [selected, setSelected] = useState<{ page: number; index: number } | null>(null);
  const [setId, setSetId] = useState("me5");
  const [setName, setSetName] = useState("Pitch Black");

  // ALL sets, not just collected ones: a binder is a plan, and planning a
  // set you have not started is the common case.
  const { data: allSets } = useSets();
  const view = useSetView(setId, setName, { rarities: null, wantPrintings: true });

  const owns = useMemo(
    () => (slot: BinderSlot) =>
      slot.kind === "image" ? true : ownedFinishes(slot.cardId).includes(slot.finish),
    [ownedFinishes],
  );

  if (!binder) {
    return (
      <Screen title="Binder" headerLeft={<BackRow focused={false} onActivate={pop} />} canGoBack>
        <p className={styles.notice}>That binder no longer exists.</p>
      </Screen>
    );
  }

  const spec = specFor(binder.format);
  const counts = countBinder(binder);

  const commit = (next: typeof binder) => setBinders(repo.saveBinder(trimPages(next)));

  const place = (slot: BinderSlot | null) => {
    if (!selected) return;
    commit(placeSlot(binder, selected.page, selected.index, slot, Date.now()));
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
        <button
          type="button"
          className={styles.chip}
          onClick={() => commit(placeSlot(binder, binder.pages.length, 0, null, Date.now()))}
        >
          Add page
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

      {binder.pages.map((page, i) => (
        <BinderPageView
          key={i}
          page={page}
          format={binder.format}
          owns={owns}
          pageNumber={i + 1}
          selectedIndex={selected?.page === i ? selected.index : null}
          onSlotClick={(index) =>
            setSelected((cur) => (cur?.page === i && cur.index === index ? null : { page: i, index }))
          }
        />
      ))}

      {selected ? (
        <div className={styles.picker}>
          <div className={styles.pickerHead}>
            {/* A plain select, not the SetSwitcher: that one NAVIGATES to a
                set, which would abandon the binder mid-edit. */}
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
            <button type="button" className={styles.chip} onClick={() => place(null)}>
              Clear pocket
            </button>
          </div>

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
        </div>
      ) : null}

      <p className={styles.footnote}>
        {counts.cards} card{counts.cards === 1 ? "" : "s"} across {binder.pages.length} page
        {binder.pages.length === 1 ? "" : "s"} · {spec.label}
      </p>
    </Screen>
  );
}
