import type { MouseEvent } from "react";
import { screenToPath } from "../../../app/screenUrl.ts";
import type { PokemonCardSummary } from "../../../models/cards.ts";
import { Card, CardArt, Chip, Money, Stack } from "../../primitives/index.ts";
import { resultCaption } from "./searchState.ts";
import styles from "./Results.module.css";

/**
 * One search result: a real link to that card's details.
 *
 * ## Why a link and not a button
 *
 * A result IS a card at a URL. Making it a link is what lets it be
 * middle-clicked into a tab, copied, and read as a link by assistive
 * technology — and a search result you cannot open in a second tab is a search
 * result you have to keep going back to.
 *
 * ## Why the click is intercepted anyway
 *
 * The `details` screen carries an optional `summary`, and passing it is the
 * difference between a details page that paints its header instantly and one
 * that shows a skeleton while `getCard` runs — or, when the catalog is having
 * one of its bursts, one that can show nothing at all. The summary is already
 * in hand here; the URL deliberately does not carry it (see `screenUrl.ts`).
 *
 * `Card` renders an anchor OR a button, and takes no `onClick` alongside
 * `href` — so the handler sits on the wrapping `<li>` and catches the click as
 * it bubbles out of the real anchor. Modified clicks (new tab, new window) are
 * left to the browser, exactly as `V2Shell` does for the nav links. This is a
 * gap in the primitive rather than a trick worth repeating: `Card` wants an
 * `onPress` that may accompany `href`, with press winning a plain left click.
 */
export function ResultTile({
  card,
  owned,
  onOpen,
}: {
  card: PokemonCardSummary;
  /** Printings of this card already in the collection. */
  owned: number;
  onOpen: () => void;
}) {
  return (
    <li onClick={intercept(onOpen)}>
      <Card href={`#${screenToPath({ name: "details", cardId: card.id })}`} pad={2} className={styles.tile}>
        <Stack as="span" gap={1}>
          {/*
            Decorative: the name is right underneath in text, and a screen
            reader being read 108 card names it has to step through twice is
            worse than silence. `tile` asks the CDN for a grid-sized image,
            which is not the same thing as a size on the page.
          */}
          <CardArt src={card.imageSmall} name={card.name} detail="tile" decorative />

          <span className={styles.name}>{card.name}</span>
          {/* Set and number, always. A name search returns 108 Charizards and
              eleven of them share the name exactly; this is what tells them
              apart without opening anything. */}
          <span className={styles.meta}>{resultCaption(card)}</span>
          <span className={styles.price}>
            {/*
              The headline from the search payload. Never `$0.00` — an unpriced
              card and a worthless one are not the same card, and whole sets
              come back with no prices at all.
            */}
            <Money value={card.marketPrice} />
          </span>

          {/* Which of the 108 you already have is most of what you came to find
              out. A word, not a tint: the tile is otherwise identical. */}
          {owned > 0 ? (
            <Chip tone="accent">{owned === 1 ? "Owned" : `Owned · ${owned} printings`}</Chip>
          ) : null}
        </Stack>
      </Card>
    </li>
  );
}

/**
 * A plain left click is ours; everything else belongs to the browser.
 *
 * Same rule as the shell's nav links. Without the modifier check, ctrl-click
 * would navigate this tab AND open a new one.
 */
function intercept(run: () => void) {
  return (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    run();
  };
}
