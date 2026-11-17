import { useEffect, useMemo, useState } from "react";
import type { PokemonCardSummary } from "../../models/cards.ts";
import { ALL_COLLECT_FINISHES, availableFinishes } from "../../models/cards.ts";
import { compareFinishes, finishLabel } from "../../models/finishes.ts";
import { Screen } from "../../components/Screen.tsx";
import { CardImage } from "../../components/CardImage.tsx";
import { PriceBlock } from "../../components/PriceBlock.tsx";
import { BackRow } from "../../components/BackRow.tsx";
import { ImageFullView } from "../../components/ImageFullView.tsx";
import { LoadingState } from "../../components/States.tsx";
import { useBackableFocus } from "../../hooks/useBackableFocus.ts";
import { useCardDetails, useCardPrices } from "../../hooks/useCardDetails.ts";
import { useSetPrintings } from "../../hooks/useSetPrintings.ts";
import { printingPrice } from "../../models/printingIndex.ts";
import { printingsOf } from "../../v2/screens/details/printings.ts";
import { setIdFromCardId } from "../../utils/cardId.ts";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useLibrary } from "../../app/LibraryProvider.tsx";
import { useScreenInputEnabled } from "../../app/TextEntryProvider.tsx";
import { formatCollector, formatUsd } from "../../utils/format.ts";
import styles from "./CardDetailsScreen.module.css";

interface Props {
  cardId: string;
  summary?: PokemonCardSummary;
}

interface Action {
  key: string;
  label: string;
  /** Market price (USD) of this printing, when the printings oracle has one. */
  price?: number;
  onSelect: () => void;
}

export function CardDetailsScreen({ cardId, summary }: Props) {
  const { pop, openResults } = useNavigation();
  const { isFavorite, toggleFavorite, ownedFinishes, toggleOwned, addRecentlyViewed } = useLibrary();
  const enabled = useScreenInputEnabled();
  const [viewerOpen, setViewerOpen] = useState(false);

  const { data: card } = useCardDetails(cardId);
  const prices = useCardPrices(cardId);

  // Prefer freshly-fetched details; fall back to the summary passed in for instant paint.
  const header = card ?? summary;
  // One cached request per set, shared with the set screen and scan review.
  const printings = useSetPrintings(setIdFromCardId(cardId), header?.setName ?? "");
  const favorited = isFavorite(cardId);
  const held = ownedFinishes(cardId);

  useEffect(() => {
    if (header) addRecentlyViewed(header);
    // Only record once per card view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, Boolean(header)]);

  const actions = useMemo<Action[]>(() => {
    // The printings the card really exists in come first: the set's TCGdex
    // printings, the same oracle the set screen trusts. pokemontcg.io reports no
    // variants at all for whole sets (0/120 Pitch Black), so the pricing payload
    // is only the fallback — while printings load, or with the server off.
    // Every other finish a collector might hold follows. Poké Ball and Master
    // Ball patterns never appear in the pricing payload (verified across eight
    // sets), so without the second group they would be untrackable — but they
    // stay below the suggested ones so the common case is still the first thing
    // under the thumb.
    const number = header?.collectorNumber ?? "";
    const real = printingsOf(printings.index, number);
    const suggested = real.source === "printings" ? real.finishes : availableFinishes(header?.variants);
    // Held printings come next even when nothing suggested them — that is how a
    // hand-marked Poké Ball stays visible and removable.
    const alsoHeld = held.filter((f) => !suggested.includes(f)).sort(compareFinishes);
    const extra = ALL_COLLECT_FINISHES.filter((f) => !suggested.includes(f) && !alsoHeld.includes(f));

    const list: Action[] = [...suggested, ...alsoHeld, ...extra].map((finish) => {
      // Only a printing the oracle prices gets a figure. Unpriced shows nothing
      // rather than a guess, and rides on the row that already exists, so the
      // glasses lose no list space to it.
      const price = printingPrice(printings.index, number, finish);
      const priceText = price !== undefined ? ` · ${formatUsd(price)}` : "";
      return {
        key: `own-${finish}`,
        label: `${held.includes(finish) ? "✓" : "＋"} ${finishLabel(finish)}${priceText}`,
        ...(price !== undefined ? { price } : {}),
        onSelect: () => toggleOwned(cardId, finish),
      };
    });
    list.push({
      key: "favorite",
      label: favorited ? "★ Remove favorite" : "☆ Favorite",
      onSelect: () => header && toggleFavorite(header),
    });
    if (header?.name) {
      list.push({ key: "printings", label: "Other printings", onSelect: () => openResults(header.name) });
    }
    if (prices.isError) {
      list.push({ key: "retry", label: "Try again", onSelect: () => prices.refetch() });
    }
    return list;
  }, [favorited, held, cardId, header, openResults, toggleFavorite, toggleOwned, prices, printings.index]);

  // Focus ring content: [card image, ...actions]. Selecting the image opens the
  // full-screen viewer.
  const { backFocused, itemIndex } = useBackableFocus({
    count: actions.length + 1,
    enabled: enabled && !viewerOpen,
    onBack: pop,
    onSelect: (i) => (i === 0 ? setViewerOpen(true) : actions[i - 1]?.onSelect()),
  });
  const imageFocused = itemIndex === 0;

  if (!header) {
    return (
      <Screen title="Card" canGoBack>
        <BackRow focused onActivate={pop} />
        <LoadingState label="Loading card…" />
      </Screen>
    );
  }

  const variantLine = [card?.rarity ?? summary?.rarity, card?.subtypes?.join(" · ")]
    .filter(Boolean)
    .join(" — ");

  return (
    <Screen title={header.name} canGoBack>
      <BackRow focused={backFocused} onActivate={pop} />
      <div className={styles.top}>
        <button
          type="button"
          className={`${styles.imageBtn} ${imageFocused ? styles.imageFocused : ""}`}
          aria-label={`View ${header.name} full screen`}
          aria-selected={imageFocused}
          onClick={() => setViewerOpen(true)}
        >
          <CardImage src={header.imageLarge ?? header.imageSmall} alt={header.name} size="large" />
          <span className={styles.enlarge} aria-hidden="true">
            ⤢
          </span>
        </button>
        <div className={styles.info}>
          <div className={styles.set}>{header.setName}</div>
          <div className={styles.number}>{formatCollector(header.collectorNumber)}</div>
          {variantLine ? <div className={styles.variant}>{variantLine}</div> : null}
          <dl className={styles.meta}>
            {header.setCode ? (
              <div>
                <dt>Set code</dt>
                <dd>{header.setCode}</dd>
              </div>
            ) : null}
            {card?.releaseDate ? (
              <div>
                <dt>Released</dt>
                <dd>{card.releaseDate}</dd>
              </div>
            ) : null}
            {card?.artist ? (
              <div>
                <dt>Artist</dt>
                <dd>{card.artist}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      </div>

      {prices.isLoading && !prices.prices ? (
        <div className={styles.pricePlaceholder}>Loading price…</div>
      ) : (
        <PriceBlock prices={prices.prices} stale={prices.isStale} />
      )}

      <ul className={styles.actions} role="listbox" aria-label="Card actions">
        {actions.map((action, i) => {
          const on = itemIndex === i + 1; // slot 0 is the image
          return (
            <li
              key={action.key}
              role="option"
              aria-selected={on}
              className={`${styles.action} ${on ? styles.actionFocused : ""}`}
              data-printing-price={action.price}
              onClick={() => action.onSelect()}
            >
              {action.label}
            </li>
          );
        })}
      </ul>

      {viewerOpen ? (
        <ImageFullView
          src={header.imageLarge ?? header.imageSmall}
          alt={header.name}
          onClose={() => setViewerOpen(false)}
        />
      ) : null}
    </Screen>
  );
}
