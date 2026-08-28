import { useMemo, useState, type FormEvent } from "react";
import { useBindersValue } from "../../hooks/useBindersValue.ts";
import type { BinderValueSummary } from "../../models/binderValue.ts";
import { formatUsd } from "../../utils/format.ts";
import { Screen } from "../../components/Screen.tsx";
import { BackRow } from "../../components/BackRow.tsx";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useLibrary } from "../../app/LibraryProvider.tsx";
import {
  BINDER_FORMATS,
  countBinder,
  emptyBinder,
  specFor,
  type BinderFormat,
} from "../../models/binderLayout.ts";
import styles from "./WebBinderScreen.module.css";

/**
 * A binder's total, on the row.
 *
 * "Pricing…" rather than a blank or a zero while the sets answer: a total that
 * appears out of nothing looks like a number that changed, and $0.00 is the one
 * thing this figure must never say when it simply does not know yet.
 */
function BinderTotal({ summary, loading }: { summary?: BinderValueSummary; loading: boolean }) {
  if (!summary || (loading && summary.priced === 0)) {
    return <span className={styles.binderValuePending}>Pricing…</span>;
  }
  return (
    <span className={styles.binderValue}>
      {formatUsd(summary.total)}
      {summary.unpriced > 0 ? (
        <span className={styles.binderValueNote}> · {summary.unpriced} unpriced</span>
      ) : null}
    </span>
  );
}

/**
 * Ids must be unique across DEVICES, not just this one, because they are the * key binders converge on: two phones that both minted "b1" would merge into
 * one binder and the older arrangement would vanish. The clock alone is not
 * enough — two devices creating a binder in the same millisecond is unlikely
 * but the failure is silent and permanent — so it carries randomness too.
 */
function newId(): string {
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Your binders.
 *
 * A binder is a layout, not a second collection: it holds positions, and what
 * you own is answered by the collection at render time. That is why a card you
 * do not have can sit in a pocket and simply render shadowed — the binder is a
 * plan, and planning around gaps is the point.
 */
export function WebBindersScreen() {
  const { pop, push } = useNavigation();
  const { binders, saveBinder, deleteBinder } = useLibrary();
  const [name, setName] = useState("");
  const [format, setFormat] = useState<BinderFormat>("9");

  /**
   * Only the binders that asked to be priced.
   *
   * Filtered HERE rather than inside the hook so the cost is visible at the
   * call site: each binder in this list is a request per set it spans, and this
   * screen makes none otherwise.
   */
  const priced = useMemo(() => binders.filter((b) => b.showValue), [binders]);
  const values = useBindersValue(priced);
  const create = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const binder = emptyBinder(newId(), trimmed, format, Date.now());
    saveBinder(binder);
    setName("");
    push({ name: "binder", binderId: binder.id });
  };

  return (
    <Screen title="Binders" headerLeft={<BackRow focused={false} onActivate={pop} />} canGoBack>
      <form className={styles.create} onSubmit={create}>
        <input
          className={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Binder name"
          aria-label="Binder name"
        />
        <div className={styles.formats} role="group" aria-label="Binder format">
          {BINDER_FORMATS.map((f) => (
            <button
              key={f}
              type="button"
              className={`${styles.chip} ${format === f ? styles.chipOn : ""}`}
              aria-pressed={format === f}
              onClick={() => setFormat(f)}
            >
              {specFor(f).label}
            </button>
          ))}
        </div>
        <button type="submit" className={styles.primary} disabled={!name.trim()}>
          Create binder
        </button>
      </form>

      {binders.length === 0 ? (
        <p className={styles.notice}>
          No binders yet. Name one above — a Vault X 9-pocket or 12-pocket — and start dropping cards into
          pockets.
        </p>
      ) : (
        <ul className={styles.list}>
          {binders.map((binder) => {
            const counts = countBinder(binder);
            return (
              <li key={binder.id}>
                <div className={styles.binderRow}>
                  <button
                    type="button"
                    className={styles.card}
                    style={{ flexDirection: "column", alignItems: "flex-start" }}
                    onClick={() => push({ name: "binder", binderId: binder.id })}
                  >
                    <span className={styles.binderName}>
                      {binder.name}
                      {/* A binder that is on offer looks like any other in this
                          list, and "which one did I mark for trade" is the
                          question the list exists to answer at a glance. */}
                      {binder.forTrade ? <span className={styles.tradeTag}>For trade</span> : null}
                    </span>
                    <span className={styles.binderMeta}>
                      {specFor(binder.format).label} · {counts.filled}/{counts.pockets} filled ·{" "}
                      {binder.pages.length} page{binder.pages.length === 1 ? "" : "s"}
                      {binder.forTrade && counts.copies !== counts.cards ? ` · ${counts.copies} cards` : ""}
                    </span>
                    {/* The headline figure, for binders that asked for one. The
                        unpriced count rides with it rather than being dropped:
                        whole sets have no market price, and a total that hid
                        that would read as the whole answer. */}
                    {binder.showValue ? (
                      <BinderTotal summary={values.byId.get(binder.id)} loading={values.isLoading} />
                    ) : null}{" "}
                  </button>
                  <button type="button" className={styles.danger} onClick={() => deleteBinder(binder.id)}>
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Screen>
  );
}
