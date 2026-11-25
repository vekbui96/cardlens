import { useEffect, useMemo } from "react";
import { screenToPath } from "../../../app/screenUrl.ts";
import { useSetView } from "../../../hooks/useSetView.ts";
import type { ParsedCardLine } from "../../../models/cardListParse.ts";
import type { PokemonCardSummary, PokemonSet } from "../../../models/cards.ts";
import { finishLabel } from "../../../models/finishes.ts";
import { formatPrice } from "../../../utils/format.ts";
import {
  Card,
  CardArt,
  ErrorNotice,
  Money,
  Panel,
  ScreenReaderOnly,
  Stack,
  UNPRICED,
} from "../../primitives/index.ts";
import type { AddEntry } from "./applyPlan.ts";
import styles from "./addmany.module.css";

export interface MissingLine {
  line: number;
  raw: string;
  reason: string;
}

const unpadded = (n: string): string => n.replace(/^0+(?=\d)/, "").toLowerCase();

/**
 * The lines of a pasted list that belong to one set, matched against that set's
 * cards. Lines whose number is not in the set are reported upward, so the
 * screen can list them under "Not recognised" next to the other failures.
 */
export function PreviewSet({
  set,
  lines,
  onMissing,
  onMatched,
}: {
  set: PokemonSet;
  lines: readonly ParsedCardLine[];
  onMissing: (setId: string, lines: MissingLine[]) => void;
  /** The printings the matched lines would add, for the screen's Add button. */
  onMatched?: (setId: string, entries: AddEntry[]) => void;
}) {
  const view = useSetView(set.id, set.name, { wantPrintings: true });

  const byNumber = useMemo(() => {
    const map = new Map<string, PokemonCardSummary>();
    for (const card of view.allCards ?? []) map.set(unpadded(card.collectorNumber), card);
    return map;
  }, [view.allCards]);

  const ready = view.allCards !== undefined;
  const matched = useMemo(
    () => (ready ? lines.filter((l) => byNumber.has(unpadded(l.number))) : []),
    [ready, lines, byNumber],
  );
  const missing = useMemo<MissingLine[]>(
    () =>
      ready
        ? lines
            .filter((l) => !byNumber.has(unpadded(l.number)))
            .map((l) => ({
              line: l.line,
              raw: l.raw,
              reason: `${set.name} has no card number ${l.number}.`,
            }))
        : [],
    [ready, lines, byNumber, set.name],
  );

  useEffect(() => {
    onMissing(set.id, missing);
  }, [onMissing, set.id, missing]);

  const entries = useMemo<AddEntry[]>(() => {
    if (!ready) return [];
    const out: AddEntry[] = [];
    for (const l of matched) {
      const card = byNumber.get(unpadded(l.number));
      if (!card) continue;
      const finish = l.finish ?? view.finishesFor(card.collectorNumber, card.variants)[0] ?? "normal";
      out.push({ cardId: card.id, finish, setId: set.id, number: card.collectorNumber });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- finishesFor changes identity each render; the inputs below decide the result
  }, [ready, matched, byNumber, set.id, view.allCards]);

  useEffect(() => {
    onMatched?.(set.id, entries);
    return () => onMatched?.(set.id, []);
  }, [onMatched, set.id, entries]);

  if (!ready && view.isError) {
    return (
      <ErrorNotice
        title={set.name}
        headingLevel={2}
        stillWorks="The other sets in your list are not affected."
        onRetry={view.refetch}
      >
        Could not load {set.name}.
      </ErrorNotice>
    );
  }

  if (!ready) {
    return (
      <Panel title={set.name} headingLevel={2}>
        <Stack gap={2} aria-busy="true">
          <ScreenReaderOnly>Loading {set.name}</ScreenReaderOnly>
          <span className={styles.skeleton} />
          <span className={styles.skeleton} />
        </Stack>
      </Panel>
    );
  }

  if (matched.length === 0) return null;

  return (
    <Panel
      title={set.name}
      headingLevel={2}
      aside={<span className={styles.meta}>{set.code ?? set.id.toUpperCase()}</span>}
    >
      <ul className={styles.list} data-testid="addmany-matched">
        {matched.map((l) => {
          const card = byNumber.get(unpadded(l.number));
          if (!card) return null;
          const finish = l.finish ?? view.finishesFor(card.collectorNumber, card.variants)[0] ?? "normal";
          // A printing the collector named is priced as that printing or not at all:
          // the headline price is for "the card", never a stand-in for a chosen finish.
          const unit = l.finish
            ? view.priceFor(card.collectorNumber, finish)
            : (view.headlinePriceFor(card) ?? view.priceFor(card.collectorNumber, finish));
          const total = unit === undefined ? undefined : unit * l.quantity;
          const detail = [
            `#${card.collectorNumber}`,
            finishLabel(finish),
            l.quantity > 1 ? `×${l.quantity}` : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={l.line}>
              <Card
                href={`#${screenToPath({ name: "details", cardId: card.id })}`}
                pad={2}
                label={`${card.name}, ${detail}, ${formatPrice(total)}`}
              >
                <div className={styles.row}>
                  <span className={styles.art}>
                    <CardArt src={card.imageSmall} name={card.name} detail="tile" decorative />
                  </span>
                  <span className={styles.text}>
                    <span className={styles.name}>{card.name}</span>
                    <span className={styles.detail}>{detail}</span>
                  </span>
                  <span className={styles.price}>
                    <Money value={total} absentLabel={UNPRICED} />
                  </span>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
