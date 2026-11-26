import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useCatalogSearch } from "../../../hooks/useCatalogSearch.ts";
import type { PokemonCardSummary } from "../../../models/cards.ts";
import { CardArt, Money, Panel, Stack, UNPRICED } from "../../primitives/index.ts";
import { sideTotal, type SideTotal } from "./balanceModel.ts";
import type { TradeLine } from "./summaryText.ts";
import styles from "./tradebuilder.module.css";

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Most search results shown at once. */
const MAX_RESULTS = 8;
/** Most copies of one card on a side. */
const MAX_QTY = 99;

interface GetChoice {
  card: PokemonCardSummary;
  qty: number;
}

interface Props {
  /** Told the side's totals whenever they change, for the balance line. */
  onTotal?: (total: SideTotal) => void;
  /** Told the chosen cards whenever they change, for the copy and image summary. */
  onLines?: (lines: TradeLine[]) => void;
}

/**
 * The "I get" side: search any card, tap one to add it, set how many, and see
 * what the side adds up to. Held in state only, so a reload clears it. Prices
 * are the catalog's market price (USD); a card without one is "Unpriced".
 */
export function GetSide({ onTotal, onLines }: Props) {
  const [choices, setChoices] = useState<GetChoice[]>([]);
  const [text, setText] = useState("");
  // Typing does not search, submit does (the Search screen's rule).
  const [query, setQuery] = useState("");

  const search = useCatalogSearch(query, undefined, { full: true });
  const chosen = useMemo(() => new Set(choices.map((c) => c.card.id)), [choices]);
  const results = useMemo(
    () => (search.data ?? []).filter((c) => !chosen.has(c.id)).slice(0, MAX_RESULTS),
    [search.data, chosen],
  );

  const totals = useMemo(
    () => sideTotal(choices.map((c) => ({ price: c.card.marketPrice, qty: c.qty }))),
    [choices],
  );
  useEffect(() => onTotal?.(totals), [onTotal, totals]);
  useEffect(
    () =>
      onLines?.(
        choices.map((c) => ({
          name: c.card.name,
          setName: c.card.setName,
          collectorNumber: c.card.collectorNumber,
          qty: c.qty,
          price: c.card.marketPrice,
        })),
      ),
    [onLines, choices],
  );

  const setQty = (id: string, qty: number) =>
    setChoices((all) =>
      all.map((c) => (c.card.id === id ? { ...c, qty: Math.max(1, Math.min(qty, MAX_QTY)) } : c)),
    );

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setQuery(text.trim());
  };

  return (
    <Panel title="I get" headingLevel={2}>
      <Stack gap={4}>
        {choices.length === 0 ? (
          <p className={styles.meta} data-testid="get-empty">
            Now add the cards you would get. Search any card by name, add it, and the balance below shows
            whether the trade is fair.
          </p>
        ) : null}

        <form onSubmit={onSubmit} role="search">
          <label htmlFor="get-search" className={styles.label}>
            Add a card you would get
          </label>
          <input
            id="get-search"
            type="search"
            className={styles.field}
            value={text}
            placeholder="Search any card by name, then press Enter"
            autoComplete="off"
            enterKeyHint="search"
            onChange={(e) => setText(e.target.value)}
          />
        </form>

        {query !== "" && search.isLoading ? <p className={styles.meta}>Searching…</p> : null}
        {query !== "" && search.isError ? (
          <p className={styles.meta}>Search failed. Try again in a moment.</p>
        ) : null}
        {query !== "" && search.isSuccess && (search.data?.length ?? 0) === 0 ? (
          <p className={styles.meta}>No cards match that. Check the spelling, or search by Pokémon.</p>
        ) : null}

        {results.length > 0 ? (
          <ul className={styles.list} aria-label="Search results">
            {results.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={styles.pick}
                  aria-label={`Get ${c.name}, ${c.setName} ${c.collectorNumber}`}
                  onClick={() => setChoices((all) => [...all, { card: c, qty: 1 }])}
                >
                  <Line card={c} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {choices.length > 0 ? (
          <>
            <ul className={styles.list} aria-label="Cards you get" data-testid="get-list">
              {choices.map(({ card, qty }) => (
                <li key={card.id} className={styles.chosen}>
                  <Line card={card} />
                  <div className={styles.controls}>
                    <button
                      type="button"
                      className={styles.step}
                      aria-label={`Fewer ${card.name}`}
                      disabled={qty <= 1}
                      onClick={() => setQty(card.id, qty - 1)}
                    >
                      −
                    </button>
                    <span className={styles.qty} aria-label={`${qty} to get`}>
                      {qty}
                    </span>
                    <button
                      type="button"
                      className={styles.step}
                      aria-label={`More ${card.name}`}
                      disabled={qty >= MAX_QTY}
                      onClick={() => setQty(card.id, qty + 1)}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      className={styles.remove}
                      aria-label={`Remove ${card.name} from what you get`}
                      onClick={() => setChoices((all) => all.filter((c) => c.card.id !== card.id))}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <p className={styles.total} data-testid="get-total">
              <span>{plural(totals.cards, "card", "cards")} · </span>
              {totals.total > 0 ? <Money value={totals.total} /> : <span>No price yet</span>}
              {totals.unpriced > 0 ? <span> · {totals.unpriced} unpriced, left out of the total</span> : null}
            </p>
          </>
        ) : null}
      </Stack>
    </Panel>
  );
}

function Line({ card }: { card: PokemonCardSummary }) {
  return (
    <span className={styles.row}>
      <span className={styles.art}>
        <CardArt src={card.imageSmall} name={card.name} detail="tile" decorative />
      </span>
      <span className={styles.text}>
        <span className={styles.name}>{card.name}</span>
        <span className={styles.detail}>
          {card.setName} {card.collectorNumber}
        </span>
      </span>
      <span className={styles.price} data-testid="get-price">
        <Money value={card.marketPrice} absentLabel={UNPRICED} />
      </span>
    </span>
  );
}
