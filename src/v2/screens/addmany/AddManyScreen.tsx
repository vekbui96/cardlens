import { useCallback, useMemo, useState } from "react";
import { useSets } from "../../../hooks/useSets.ts";
import { parseCardList, type ParsedCardLine } from "../../../models/cardListParse.ts";
import type { PokemonSet } from "../../../models/cards.ts";
import { Panel, Stack } from "../../primitives/index.ts";
import { readOwnedCsv } from "../../../models/ownedCsvRead.ts";
import { expandRange, rangeToLines } from "../../../models/setRange.ts";
import { PreviewSet, type MissingLine } from "./PreviewSet.tsx";
import { useLibrary } from "../../../app/LibraryProvider.tsx";
import { asOwned, planAdd, type AddEntry } from "./applyPlan.ts";
import styles from "./addmany.module.css";

/** Three tappable lines that teach the format. */
const EXAMPLES = ["SV3 125", "sv3 125 x2", "sv3 125 holo"] as const;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** A set by its short code (OBF) or its id (sv3), whichever the collector typed. */
function findSet(sets: readonly PokemonSet[], typed: string): PokemonSet | undefined {
  const wanted = typed.toLowerCase();
  return (
    sets.find((s) => s.code?.toLowerCase() === wanted) ?? sets.find((s) => s.id.toLowerCase() === wanted)
  );
}

type Mode = "list" | "set" | "csv";
const MODES: readonly (readonly [Mode, string])[] = [
  ["list", "Paste list"],
  ["set", "Whole set"],
  ["csv", "CSV file"],
];

interface NotRecognised {
  line: number;
  raw: string;
  reason: string;
}

/**
 * Add many cards, step one: paste a list and see what it would add.
 *
 * "Add N cards" writes the matched lines through setOwnedMany; Undo reverses
 * exactly what that add turned on. Each set in the list loads through
 * the Set screen's own data path, so a card here has the same name, image and
 * price as it has there, and a failed set says so on its own while the other
 * sets still show.
 */
export function AddManyScreen() {
  const [mode, setMode] = useState<Mode>("list");
  const [typed, setText] = useState("");
  const { data: sets, isLoading: setsLoading } = useSets();

  // Whole set: a set and a range become `<set> <number>` lines.
  const [rangeSetId, setRangeSetId] = useState("");
  const [rangeText, setRangeText] = useState("1-50");
  const range = useMemo(() => expandRange(rangeText), [rangeText]);
  const rangeSet = sets?.find((s) => s.id === rangeSetId);

  // CSV: the file's text, read into lines once the sets are known.
  const [csv, setCsv] = useState<{ name: string; text: string } | null>(null);
  const csvRead = useMemo(() => {
    if (!csv || !sets) return null;
    const byName = (name: string) => sets.find((s) => s.name.toLowerCase() === name.toLowerCase())?.id;
    return readOwnedCsv(csv.text, byName);
  }, [csv, sets]);
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setCsv({ name: file.name, text: await file.text() });
  };

  const text =
    mode === "list"
      ? typed
      : mode === "set"
        ? rangeSet && range.ok
          ? rangeToLines(rangeSet.id, range.numbers)
          : ""
        : (csvRead?.text ?? "");
  const parsed = useMemo(() => parseCardList(text), [text]);
  const csvProblems: NotRecognised[] = mode === "csv" ? (csvRead?.problems ?? []) : [];

  const { groups, unknownSet } = useMemo(() => {
    const bySet = new Map<string, { set: PokemonSet; lines: ParsedCardLine[] }>();
    const unknown: NotRecognised[] = [];
    for (const line of parsed.lines) {
      if (!line.ok) continue;
      const set = sets ? findSet(sets, line.setCode) : undefined;
      if (!set) {
        if (sets)
          unknown.push({ line: line.line, raw: line.raw, reason: `No set with the code ${line.setCode}.` });
        continue;
      }
      const group = bySet.get(set.id) ?? { set, lines: [] };
      group.lines.push(line);
      bySet.set(set.id, group);
    }
    return { groups: [...bySet.values()], unknownSet: unknown };
  }, [parsed, sets]);

  const [missing, setMissing] = useState<Record<string, MissingLine[]>>({});
  const onMissing = useCallback((setId: string, lines: MissingLine[]) => {
    setMissing((prev) => (prev[setId] === lines ? prev : { ...prev, [setId]: lines }));
  }, []);

  const { isOwnedFinish, setOwnedMany } = useLibrary();
  const [matchedBySet, setMatchedBySet] = useState<Record<string, AddEntry[]>>({});
  const onMatched = useCallback((setId: string, entries: AddEntry[]) => {
    setMatchedBySet((prev) => {
      const had = prev[setId];
      if (entries.length === 0) {
        if (!had) return prev;
        const { [setId]: _gone, ...rest } = prev;
        return rest;
      }
      return { ...prev, [setId]: entries };
    });
  }, []);
  const matchedEntries = useMemo(
    () => groups.flatMap((g) => matchedBySet[g.set.id] ?? []),
    [groups, matchedBySet],
  );
  const toAdd = useMemo(() => planAdd(matchedEntries, isOwnedFinish), [matchedEntries, isOwnedFinish]);
  // Held in memory only: Undo reverses exactly the printings the last add turned on.
  const [undo, setUndo] = useState<AddEntry[] | null>(null);
  const [addedCount, setAddedCount] = useState(0);

  const onAdd = () => {
    if (toAdd.length === 0) return;
    setOwnedMany(asOwned(toAdd, true));
    setUndo(toAdd);
    setAddedCount(toAdd.length);
  };
  const onUndo = () => {
    if (!undo) return;
    setOwnedMany(asOwned(undo, false));
    setUndo(null);
  };

  const notRecognised: NotRecognised[] = [
    ...parsed.lines.flatMap((l) => (l.ok ? [] : [{ line: l.line, raw: l.raw, reason: l.reason }])),
    ...unknownSet,
    ...csvProblems,
    ...groups.flatMap((g) => missing[g.set.id] ?? []),
  ].sort((a, b) => a.line - b.line);

  const lineCount = parsed.lines.length;
  const showPreview = lineCount > 0 || csvProblems.length > 0;

  return (
    <Stack gap={5}>
      <header>
        <h1 className={styles.title}>Add many cards</h1>
        <p className={styles.meta}>
          Paste a list, add a whole set or import a CSV, and see what it would add.
        </p>
      </header>

      <div className={styles.examples} role="group" aria-label="How to fill the preview">
        {MODES.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={styles.example}
            aria-pressed={mode === id}
            data-active={mode === id ? "true" : undefined}
            onClick={() => setMode(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "set" ? (
        <Stack gap={2}>
          <label htmlFor="addmany-set" className={styles.label}>
            Set
          </label>
          <select
            id="addmany-set"
            className={styles.field}
            value={rangeSetId}
            onChange={(e) => setRangeSetId(e.target.value)}
          >
            <option value="">{setsLoading ? "Loading sets…" : "Choose a set"}</option>
            {(sets ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <label htmlFor="addmany-range" className={styles.label}>
            Card numbers
          </label>
          <input
            id="addmany-range"
            className={styles.field}
            value={rangeText}
            onChange={(e) => setRangeText(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            placeholder="1-50"
          />
          <p className={styles.meta} data-testid="addmany-range-count">
            {!range.ok
              ? range.reason
              : rangeSet
                ? `${plural(range.numbers.length, "card", "cards")} from ${rangeSet.name}. Numbers the set does not have are listed under Not recognised.`
                : "Choose a set to see its cards."}
          </p>
        </Stack>
      ) : null}

      {mode === "csv" ? (
        <Stack gap={2}>
          <label htmlFor="addmany-csv" className={styles.label}>
            Choose CSV file
          </label>
          <input
            id="addmany-csv"
            type="file"
            accept=".csv,text/csv"
            className={styles.field}
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <p className={styles.meta} data-testid="addmany-csv-hint">
            {csv
              ? `${csv.name}: ${plural(csvRead?.rows ?? 0, "row", "rows")} read.`
              : "Use a file from Download CSV of owned cards: name, set, number, finish, price. Prices come from the catalog; an unknown price shows unpriced."}
          </p>
        </Stack>
      ) : null}

      {mode === "list" ? (
        <Stack gap={2}>
          <label htmlFor="addmany-text" className={styles.label}>
            Your card list
          </label>
          <textarea
            id="addmany-text"
            className={styles.textarea}
            value={typed}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder={"SV3 125\nsv3 126 x2\nsv3 127 holo"}
          />
          <p className={styles.meta} data-testid="addmany-hint">
            Each line is a set code, a card number, then optionally a quantity (x2) and a printing (normal,
            reverse, holo, 1st). Tap an example to try it:
          </p>
          <div className={styles.examples} role="group" aria-label="Example lines">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                className={styles.example}
                onClick={() =>
                  setText((t) => (t.trim() === "" ? example : `${t.replace(/\s+$/, "")}\n${example}`))
                }
              >
                {example}
              </button>
            ))}
          </div>
        </Stack>
      ) : null}

      {showPreview ? (
        <Stack gap={4}>
          <p className={styles.headline} data-testid="addmany-summary">
            {plural(lineCount, "line", "lines")} read
            {parsed.duplicates.length > 0
              ? ` · ${plural(parsed.duplicates.length, "card appears", "cards appear")} more than once (${parsed.duplicates.join(", ")})`
              : ""}
          </p>

          {setsLoading ? (
            <Panel title="Matching your list" headingLevel={2}>
              <p className={styles.meta}>Looking up sets…</p>
            </Panel>
          ) : null}

          {groups.map((g) => (
            <PreviewSet
              key={g.set.id}
              set={g.set}
              lines={g.lines}
              onMissing={onMissing}
              onMatched={onMatched}
            />
          ))}

          {matchedEntries.length > 0 ? (
            <div className={styles.addBar}>
              {toAdd.length > 0 ? (
                <button type="button" className={styles.addButton} onClick={onAdd}>
                  Add {plural(toAdd.length, "card", "cards")}
                </button>
              ) : undo === null ? (
                <p className={styles.meta} data-testid="addmany-already">
                  Everything matched is already in your collection.
                </p>
              ) : null}
              {undo !== null ? (
                <>
                  <p className={styles.headline} role="status" data-testid="addmany-added">
                    Added {plural(addedCount, "card", "cards")}
                  </p>
                  <button type="button" className={styles.undoButton} onClick={onUndo}>
                    Undo
                  </button>
                </>
              ) : null}
            </div>
          ) : null}

          {notRecognised.length > 0 ? (
            <Panel
              title="Not recognised"
              headingLevel={2}
              aside={<span className={styles.meta}>{plural(notRecognised.length, "line", "lines")}</span>}
            >
              <ul className={styles.missing} data-testid="addmany-not-recognised">
                {notRecognised.map((n) => (
                  <li key={n.line} className={styles.missingRow}>
                    <span className={styles.raw}>
                      {n.line}. {n.raw}
                    </span>
                    <span className={styles.meta}>{n.reason}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </Stack>
      ) : null}
    </Stack>
  );
}
