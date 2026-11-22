import { useEffect, useMemo } from "react";
import { screenToPath } from "../../../app/screenUrl.ts";
import { useSetPrintings } from "../../../hooks/useSetPrintings.ts";
import { useSetView } from "../../../hooks/useSetView.ts";
import type { PokemonCardSummary } from "../../../models/cards.ts";
import { finishLabel } from "../../../models/finishes.ts";
import { formatUsd } from "../../../utils/format.ts";
import {
  Card,
  CardArt,
  Chip,
  Money,
  Panel,
  Row,
  ScreenReaderOnly,
  Stack,
  UNPRICED,
} from "../../primitives/index.ts";
import { applyWantFilters, type WantFilters } from "./wantFilters.ts";
import { wantForSet, wantSetLine, type WantCard, type WantSet } from "./wantList.ts";
import styles from "./wantlist.module.css";

export type SectionKind = "loading" | "error" | "unknown" | "ready";

const unpadded = (n: string): string => n.replace(/^0+(?=\d)/, "");

/**
 * One started set on the Want list: its missing cards, or why they cannot be
 * shown yet.
 *
 * It loads exactly what the Set screen loads (`useSetView`: cached printings
 * first, one request for the set), so the two screens cannot disagree about a
 * card. A failure here stays here: it says so with a retry and never blanks the
 * other sets. It reports its state upward for the header's totals.
 */
export function WantSetSection({
  setId,
  setName,
  ownedNumbers,
  filters,
  onState,
}: {
  setId: string;
  setName: string;
  /** Collector numbers held, or null when they do not add up to the cards held (never guessed). */
  ownedNumbers: readonly string[] | null;
  filters: WantFilters;
  onState: (setId: string, kind: SectionKind, want: WantSet | null) => void;
}) {
  const view = useSetView(setId, setName, { wantPrintings: true });
  // Observes the printings query `useSetView` may have started, without
  // starting one: a set whose printings are still on the way is loading, not
  // "no data".
  const printingsQuery = useSetPrintings(setId, setName, false);
  const printingsPending = view.printings === null && printingsQuery.isFetching;
  const printingsFailed = view.printings === null && printingsQuery.isError;

  const cardsByNumber = useMemo(() => {
    const map = new Map<string, PokemonCardSummary>();
    for (const card of view.allCards ?? []) map.set(unpadded(card.collectorNumber), card);
    return map;
  }, [view.allCards]);

  // Rarity comes from the catalog card; the printing index does not know it.
  const want = useMemo(() => {
    const found = ownedNumbers ? wantForSet(ownedNumbers, view.printings) : null;
    if (!found) return null;
    return {
      ...found,
      cards: found.cards.map((c) => {
        const rarity = cardsByNumber.get(unpadded(c.collectorNumber))?.rarity;
        return rarity ? { ...c, rarity } : c;
      }),
    };
  }, [ownedNumbers, view.printings, cardsByNumber]);
  const kind: SectionKind =
    view.isLoading || printingsPending
      ? "loading"
      : view.isError || printingsFailed
        ? "error"
        : want
          ? "ready"
          : "unknown";

  useEffect(() => {
    onState(setId, kind, kind === "ready" ? want : null);
  }, [onState, setId, kind, want]);

  const shown = useMemo(() => (want ? applyWantFilters(want, filters) : null), [want, filters]);

  // Another set is chosen: this one stays loaded (its numbers feed the filter list) but is not shown.
  if (filters.setId !== null && filters.setId !== setId) return null;

  if (kind === "loading") return <SetSkeleton setName={setName} />;

  if (kind === "error") {
    return (
      <Panel title={setName} headingLevel={2} tone="raised">
        <Stack gap={3}>
          <p className={styles.meta}>Could not load {setName}. The other sets are not affected.</p>
          <Row gap={2}>
            <Chip
              tone="accent"
              label={`Try loading ${setName} again`}
              onPress={() => {
                view.refetch();
                if (printingsFailed) void printingsQuery.refetch();
              }}
            >
              Try again
            </Chip>
          </Row>
        </Stack>
      </Panel>
    );
  }

  if (kind === "unknown" || !want || !shown) {
    return (
      <Panel title={setName} headingLevel={2}>
        <p className={styles.meta}>
          {ownedNumbers
            ? `No printing data for ${setName} yet, so its missing cards cannot be listed.`
            : `Some cards in ${setName} were marked without a collector number, so its missing cards cannot be listed.`}
        </p>
      </Panel>
    );
  }

  // A finished set is not on a want list.
  if (want.missing === 0) return null;
  // Nothing here matches the chosen rarities.
  if (shown.missing === 0) return null;

  return (
    <Panel title={setName} headingLevel={2} aside={<span className={styles.meta}>{wantSetLine(shown)}</span>}>
      <ul className={styles.list}>
        {shown.cards.map((wanted) => (
          <li key={wanted.collectorNumber}>
            <WantRow
              setId={setId}
              wanted={wanted}
              card={cardsByNumber.get(unpadded(wanted.collectorNumber))}
            />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function WantRow({
  setId,
  wanted,
  card,
}: {
  setId: string;
  wanted: WantCard;
  card: PokemonCardSummary | undefined;
}) {
  const name = card?.name ?? `Card ${wanted.collectorNumber}`;
  const cardId = card?.id ?? `${setId}-${unpadded(wanted.collectorNumber)}`;
  const detail = [`#${wanted.collectorNumber}`, card?.rarity, finishLabel(wanted.finish)]
    .filter(Boolean)
    .join(" · ");
  return (
    <Card
      href={`#${screenToPath({ name: "details", cardId })}`}
      pad={2}
      label={`${name}, ${detail}, ${wanted.price === null ? UNPRICED : formatUsd(wanted.price)}`}
    >
      <div className={styles.row}>
        <span className={styles.art}>
          <CardArt src={card?.imageSmall} name={name} detail="tile" decorative />
        </span>
        <span className={styles.text}>
          <span className={styles.name}>{name}</span>
          <span className={styles.detail}>{detail}</span>
        </span>
        <span className={styles.price}>
          <Money value={wanted.price} absentLabel={UNPRICED} />
        </span>
      </div>
    </Card>
  );
}

/** The set's shape while it loads: its name and a few empty rows, never a spinner. */
export function SetSkeleton({ setName }: { setName: string }) {
  return (
    <Panel title={setName} headingLevel={2}>
      <Stack gap={2} aria-busy="true">
        <ScreenReaderOnly>Loading {setName}</ScreenReaderOnly>
        <span className={styles.skeleton} />
        <span className={styles.skeleton} />
        <span className={styles.skeleton} />
      </Stack>
    </Panel>
  );
}
