import { useEffect, useMemo } from "react";
import type { PokemonCardSummary } from "../../models/cards.ts";
import { Screen } from "../../components/Screen.tsx";
import { CardImage } from "../../components/CardImage.tsx";
import { PriceBlock } from "../../components/PriceBlock.tsx";
import { LoadingState } from "../../components/States.tsx";
import { useFocusList } from "../../hooks/useFocusList.ts";
import { useCardDetails, useCardPrices } from "../../hooks/useCardDetails.ts";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useLibrary } from "../../app/LibraryProvider.tsx";
import { useScreenInputEnabled } from "../../app/TextEntryProvider.tsx";
import { formatCollector } from "../../utils/format.ts";
import styles from "./CardDetailsScreen.module.css";

interface Props {
  cardId: string;
  summary?: PokemonCardSummary;
}

interface Action {
  key: string;
  label: string;
  onSelect: () => void;
}

export function CardDetailsScreen({ cardId, summary }: Props) {
  const { pop, openResults } = useNavigation();
  const { isFavorite, toggleFavorite, addRecentlyViewed } = useLibrary();
  const enabled = useScreenInputEnabled();

  const { data: card } = useCardDetails(cardId);
  const prices = useCardPrices(cardId);

  // Prefer freshly-fetched details; fall back to the summary passed in for instant paint.
  const header = card ?? summary;
  const favorited = isFavorite(cardId);

  useEffect(() => {
    if (header) addRecentlyViewed(header);
    // Only record once per card view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, Boolean(header)]);

  const actions = useMemo<Action[]>(() => {
    const list: Action[] = [
      {
        key: "favorite",
        label: favorited ? "★ Remove favorite" : "☆ Favorite",
        onSelect: () => header && toggleFavorite(header),
      },
    ];
    if (header?.name) {
      list.push({ key: "printings", label: "Other printings", onSelect: () => openResults(header.name) });
    }
    if (prices.isError) {
      list.push({ key: "retry", label: "Try again", onSelect: () => prices.refetch() });
    }
    return list;
  }, [favorited, header, openResults, toggleFavorite, prices]);

  const { focusIndex } = useFocusList({
    count: actions.length,
    enabled,
    onBack: pop,
    onSelect: (i) => actions[i]?.onSelect(),
  });

  if (!header) {
    return (
      <Screen title="Card" canGoBack>
        <LoadingState label="Loading card…" />
      </Screen>
    );
  }

  const variantLine = [card?.rarity ?? summary?.rarity, card?.subtypes?.join(" · ")]
    .filter(Boolean)
    .join(" — ");

  return (
    <Screen title={header.name} canGoBack>
      <div className={styles.top}>
        <CardImage src={header.imageLarge ?? header.imageSmall} alt={header.name} size="large" />
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
        {actions.map((action, i) => (
          <li
            key={action.key}
            role="option"
            aria-selected={i === focusIndex}
            className={`${styles.action} ${i === focusIndex ? styles.actionFocused : ""}`}
            onClick={() => action.onSelect()}
          >
            {action.label}
          </li>
        ))}
      </ul>
    </Screen>
  );
}
