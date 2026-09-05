import { useEffect, useMemo, useRef, useState } from "react";
import { Row, Sheet, Stack } from "../../primitives/index.ts";
import { byCollectorNumber } from "../../../integrations/pokemon/sort.ts";
import type { CardIndex, IndexedCard } from "../../../scan/cardIndex.ts";
import styles from "./scan.module.css";

/**
 * Say what the card actually is, by set.
 *
 * Recognition refuses rather than guesses, and at full catalog size it refuses
 * for roughly one card in ten — every Base Set against Base Set 2 against
 * Legendary Collection reprint, which share their artwork exactly. The three
 * candidates it offers are the three it could not separate, so when the right
 * answer is not among them there is otherwise nowhere to go but rejecting the
 * row and typing the card in somewhere else.
 *
 * **Everything here comes from the index already in memory** — 20,205 cards
 * with their set, name and number. No request, no spinner, and it works in
 * aeroplane mode, which matters because this is the repair path for the case
 * where recognition has already gone wrong. A picker that needed the network
 * would be missing exactly when it is needed.
 */
export function PickBySet({
  index,
  initialSetId,
  onPick,
  onCancel,
}: {
  index: CardIndex;
  /** The best guess's set — usually right even when the card is not. */
  initialSetId?: string | undefined;
  onPick: (card: IndexedCard) => void;
  onCancel: () => void;
}) {
  const sets = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; cards: number }>();
    for (const c of index.cards) {
      const at = seen.get(c.setId);
      if (at) at.cards++;
      else seen.set(c.setId, { id: c.setId, name: c.setName, cards: 1 });
    }
    // By name, not catalog order: 174 sets is far past the point where scanning
    // a list beats knowing where the S's are.
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [index]);

  const [setId, setSetId] = useState(() => initialSetId ?? sets[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);

  // The set is usually already right, so the useful thing to type is the number.
  useEffect(() => search.current?.focus(), []);

  const cards = useMemo(
    () =>
      index.cards
        .filter((c) => c.setId === setId)
        .sort((a, b) => byCollectorNumber({ collectorNumber: a.number }, { collectorNumber: b.number })),
    [index, setId],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cards;
    // Number first and exactly: typing "4" in Base Set means Charizard, and a
    // name substring match would bury it under every card with a 4 in its
    // number. Anything unmatched falls through to a name search.
    const exact = cards.filter((c) => c.number.toLowerCase() === q);
    const rest = cards.filter(
      (c) =>
        c.number.toLowerCase() !== q &&
        (c.name.toLowerCase().includes(q) || c.number.toLowerCase().startsWith(q)),
    );
    return [...exact, ...rest];
  }, [cards, query]);

  return (
    <Sheet open onClose={onCancel} label="Pick the card by set">
      <Stack gap={3}>
        <h2 className={styles.sheetTitle}>Which card is it?</h2>

        {/*
          An explicit `for`/`id` pair, not a wrapping <label>.
          A <label> that CONTAINS the select takes its accessible name from its
          own text content — which includes every option in the select. The name
          came out as "Set151 (207)Ancient Origins (…" for all 174 of them, which
          is what a screen reader would announce.
        */}
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={setFieldId}>
            Set
          </label>
          <select
            id={setFieldId}
            className={styles.select}
            value={setId}
            onChange={(e) => {
              setSetId(e.target.value);
              // A number typed for the old set means nothing in the new one.
              setQuery("");
            }}
          >
            {sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.cards})
              </option>
            ))}
          </select>
        </label>

        <input
          ref={search}
          className={styles.input}
          type="text"
          value={query}
          placeholder="Number or name"
          aria-label="Filter by number or name"
          enterKeyHint="done"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && shown.length > 0) {
              e.preventDefault();
              onPick(shown[0]);
            }
          }}
        />

        <ul className={styles.pickList} aria-label="Cards in this set">
          {shown.length === 0 ? (
            <li className={styles.muted}>Nothing in this set matches.</li>
          ) : (
            // Capped because the DOM cost is real on a phone, and nobody scrolls
            // 300 rows to find a card whose number they could have typed.
            shown.slice(0, 60).map((c) => (
              <li key={c.id}>
                <button type="button" className={styles.pickOption} onClick={() => onPick(c)}>
                  <span className={styles.pickNumber}>{c.number}</span>
                  <span className={styles.pickName}>{c.name}</span>
                  {c.rarity ? <span className={styles.muted}>{c.rarity}</span> : null}
                </button>
              </li>
            ))
          )}
        </ul>

        <Row gap={3} justify="space-between">
          <span className={styles.muted}>
            {shown.length > 60 ? `Showing 60 of ${shown.length} — keep typing` : `${shown.length} cards`}
          </span>
          <button type="button" className={styles.secondary} onClick={onCancel}>
            Cancel
          </button>
        </Row>
      </Stack>
    </Sheet>
  );
}
