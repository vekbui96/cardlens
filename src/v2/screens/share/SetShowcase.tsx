import { useMemo } from "react";
import { useSetView } from "../../../hooks/useSetView.ts";
import { showcaseIndex, type ShowcasePrinting } from "../../../models/showcase.ts";
import { finishLabel } from "../../../models/finishes.ts";
import { formatCollector } from "../../../utils/format.ts";
import { CardArt, Chip, Grid, Panel, Row, Stack, cx } from "../../primitives/index.ts";
import { ShareHeader, ShareLoading } from "./ShareFrame.tsx";
import styles from "./share.module.css";

/**
 * Somebody else's progress through a set.
 *
 * The one thing this screen must not do is judge ownership against the person
 * LOOKING at it. Every mark here belongs to whoever made the link — the viewer
 * may own the whole set or none of it, and the page says exactly the same
 * thing either way. That is why the owned index is built from the share and
 * the local library is never consulted at all.
 */

interface SetShowcaseProps {
  setId: string;
  setName: string;
  /** The SHARER's printings. */
  owned: ShowcasePrinting[];
  /** True for a server-backed share, which keeps up to date after it was sent. */
  live?: boolean;
  updatedAt?: number | undefined;
}

export function SetShowcase({ setId, setName, owned, live = false, updatedAt }: SetShowcaseProps) {
  const view = useSetView(setId, setName, { wantPrintings: true });
  const held = useMemo(() => showcaseIndex({ setId, owned }), [setId, owned]);

  const cards = view.cards;
  const ownedCount = owned.length;

  if (view.isLoading && cards.length === 0) return <ShareLoading what={setName} />;

  return (
    <Stack gap={4}>
      <ShareHeader
        title={setName}
        subtitle={
          <>
            A shared set · <strong>{ownedCount}</strong> {ownedCount === 1 ? "printing" : "printings"} held
          </>
        }
        {...(live && updatedAt !== undefined ? { updatedAt } : {})}
        aside={live ? <Chip tone="accent">Live</Chip> : <Chip>Snapshot</Chip>}
      />

      {view.isError && cards.length === 0 ? (
        <Panel title="The card list could not be reached" headingLevel={2}>
          <Stack gap={3}>
            <p>
              The set this link points at could not be loaded, so there is nothing to lay the marks against.
              Nothing is wrong with the link.
            </p>
            <Row gap={2}>
              <button type="button" className={styles.button} onClick={() => view.refetch()}>
                Try again
              </button>
            </Row>
          </Stack>
        </Panel>
      ) : null}

      <Grid min="pocket" gap={3}>
        {cards.map((card) => {
          const finishes = view.finishesFor(card.collectorNumber, card.variants);
          const heldHere = finishes.filter((f) => held.has(`${card.collectorNumber}|${f}`));
          return (
            <article key={card.id} className={cx(styles.card, heldHere.length === 0 && styles.cardMissing)}>
              <CardArt src={card.imageSmall} name={card.name} detail="tile" />
              <div className={styles.cardBody}>
                <p className={styles.cardName}>{card.name}</p>
                <p className={styles.cardMeta}>{formatCollector(card.collectorNumber)}</p>
                {/*
                  Which printings, in words. A shaded tile alone would say
                  "something here is missing" without saying what, and on a
                  master set the difference between holding the normal and
                  holding the reverse is the whole question.
                */}
                {heldHere.length > 0 ? (
                  <Row gap={1} wrap>
                    {heldHere.map((f) => (
                      <Chip key={f} tone="accent">
                        {finishLabel(f)}
                      </Chip>
                    ))}
                  </Row>
                ) : (
                  <p className={styles.cardMissingLabel}>Not held</p>
                )}
              </div>
            </article>
          );
        })}
      </Grid>

      {cards.length === 0 && !view.isLoading && !view.isError ? (
        <Panel title="Nothing to show" headingLevel={2}>
          <p>This set came back empty.</p>
        </Panel>
      ) : null}
    </Stack>
  );
}
