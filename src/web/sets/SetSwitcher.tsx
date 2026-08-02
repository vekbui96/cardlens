// Aliased: the unqualified name is the DOM event, which the window listener below needs.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useCollectedSets } from "../../hooks/useCollectedSets.ts";
import styles from "./SetSwitcher.module.css";

/**
 * The set name in the header, as a switcher.
 *
 * Master-setting is not one set at a time — a collection runs to nineteen of
 * them, and moving between two of those meant back, scroll the set list, tap.
 * The name at the top of the screen is already the answer to "which set is
 * this", so it is the honest place to hang "and which else".
 *
 * The list is the sets you own cards from, in the order the Collection screen
 * ranks them (closest to complete first, via useCollectedSets) rather than
 * alphabetically or by release: the set you are nearly done with is the one you
 * are working on. Sets you have not started are one tap further on, through
 * All sets — putting 217 of them here would bury the handful that matter.
 *
 * Web only. The glasses reach the same places through their focus ring, and a
 * pointer-driven popover has nothing to offer four gestures.
 */
export function SetSwitcher({ setId, setName }: { setId: string; setName: string }) {
  const { replace, push } = useNavigation();
  const collected = useCollectedSets();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  // The set being viewed always appears, even at zero owned: opening a set from
  // the full list and finding it missing from its own switcher reads as a bug.
  const sets = collected.some((s) => s.setId === setId)
    ? collected
    : [{ setId, setName, owned: 0, printings: 0, finishes: {} }, ...collected];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      // Return focus to what opened it, or a keyboard user is stranded.
      trigger.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    // Open on the set you are in: it puts the arrow keys somewhere sensible to
    // start, and scrolls a long list to where you already are.
    menu.current?.querySelector<HTMLElement>("[aria-current='page']")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /** Arrow keys walk the list; the roles promise it, so it has to be true. */
  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(e.key)) return;
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? []);
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? items.length - 1
          : Math.min(items.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)));
    items[next]?.focus();
  };

  const go = (id: string, name: string) => {
    setOpen(false);
    if (id === setId) return;
    // Replace, not push: switching sets is a lateral move, and pushing would
    // make Back walk every set visited instead of leaving for where you came
    // from. The screen keeps its filters across the swap deliberately —
    // "missing only" is a question you ask of set after set.
    replace({ name: "set", setId: id, setName: name });
  };

  return (
    <>
      <h1 className={styles.heading}>
        <button
          ref={trigger}
          type="button"
          className={styles.trigger}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`${setName}. Switch set`}
          onClick={() => setOpen((o) => !o)}
        >
          <span className={styles.name}>{setName}</span>
          <span className={`${styles.caret} ${open ? styles.caretOpen : ""}`} aria-hidden="true">
            ▾
          </span>
        </button>
      </h1>

      {open ? (
        <>
          <div className={styles.scrim} onClick={() => setOpen(false)} role="presentation" />
          <div ref={menu} className={styles.menu} role="menu" aria-label="Switch set" onKeyDown={onMenuKey}>
            {sets.map((s) => {
              const current = s.setId === setId;
              const pct = s.ratio === undefined ? null : Math.round(s.ratio * 100);
              return (
                <button
                  key={s.setId}
                  type="button"
                  role="menuitem"
                  className={`${styles.item} ${current ? styles.itemCurrent : ""}`}
                  {...(current ? { "aria-current": "page" as const } : {})}
                  onClick={() => go(s.setId, s.setName)}
                >
                  <span className={styles.itemName}>{s.setName}</span>
                  <span className={styles.itemCount}>{s.total ? `${s.owned}/${s.total}` : `${s.owned}`}</span>
                  {/* The bar is the reason this list is ordered the way it is:
                      it makes "nearly done" visible without reading numbers. */}
                  {pct === null ? null : (
                    <span className={styles.bar} aria-hidden="true">
                      <span className={styles.barFill} style={{ width: `${pct}%` }} />
                    </span>
                  )}
                </button>
              );
            })}
            <button
              type="button"
              role="menuitem"
              className={`${styles.item} ${styles.itemAll}`}
              onClick={() => {
                setOpen(false);
                push({ name: "sets" });
              }}
            >
              <span className={styles.itemName}>All sets</span>
              <span className={styles.itemCount}>›</span>
            </button>
          </div>
        </>
      ) : null}
    </>
  );
}
