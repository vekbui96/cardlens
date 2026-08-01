import { useEffect, useRef, useState } from "react";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useLibrary } from "../../app/LibraryProvider.tsx";
import { useSearchAction } from "../../features/search/useSearchAction.ts";
import type { Screen } from "../../app/navigation.ts";
import styles from "./WebHeader.module.css";

/**
 * The web app bar.
 *
 * The glasses reach every destination through a fixed Home menu, because four
 * gestures and a focus ring make a persistent chrome bar unaffordable — every
 * row of chrome there costs roughly two rows of list. A browser has none of
 * those constraints, and burying Collection three taps deep behind Home is the
 * kind of thing that makes a web app feel like a port.
 *
 * So global navigation lives here, always one tap away, and the screen below
 * keeps its own header for local context: back, title, and progress.
 */

interface Destination {
  label: string;
  hint: string;
  screen?: Screen;
  /** Search has no screen of its own — it opens text entry, then results. */
  action?: "search";
}

const DESTINATIONS: Destination[] = [
  { label: "Search", hint: "Find a card by name", action: "search" },
  { label: "Sets", hint: "Browse and track sets", screen: { name: "sets" } },
  { label: "Collection", hint: "What you own, and what it is worth", screen: { name: "collection" } },
  { label: "Favorites", hint: "Cards you starred", screen: { name: "favorites" } },
  { label: "Recent", hint: "Searches you made", screen: { name: "recent" } },
  { label: "Popular", hint: "Commonly searched Pokémon", screen: { name: "popular" } },
];

export function WebHeader() {
  const { push, home, screen } = useNavigation();
  const { collection, favorites } = useLibrary();
  const { typeSearch } = useSearchAction();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        // Return focus to what opened it, or a keyboard user is stranded.
        toggle.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /** Counts, but only where there is something to count. A "0" is not news. */
  const countFor = (d: Destination): string | null => {
    if (d.screen?.name === "collection" && collection.length > 0) return String(collection.length);
    if (d.screen?.name === "favorites" && favorites.length > 0) return String(favorites.length);
    return null;
  };

  const go = (d: Destination) => {
    setOpen(false);
    if (d.action === "search") void typeSearch();
    else if (d.screen) push(d.screen);
  };

  return (
    <>
      <header className={styles.bar}>
        <button type="button" className={styles.brand} onClick={home} aria-label="CardLens home">
          CardLens
        </button>
        <button
          ref={toggle}
          type="button"
          className={styles.menuButton}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((o) => !o)}
        >
          <span className={`${styles.bars} ${open ? styles.barsOpen : ""}`} aria-hidden="true" />
        </button>
      </header>

      {open ? (
        <div className={styles.scrim} onClick={() => setOpen(false)} role="presentation">
          <div
            ref={panel}
            className={styles.panel}
            role="menu"
            aria-label="Go to"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            {DESTINATIONS.map((d) => {
              const count = countFor(d);
              const current = d.screen?.name === screen.name;
              return (
                <button
                  key={d.label}
                  type="button"
                  role="menuitem"
                  className={`${styles.item} ${current ? styles.itemCurrent : ""}`}
                  {...(current ? { "aria-current": "page" as const } : {})}
                  onClick={() => go(d)}
                >
                  <span className={styles.itemLabel}>{d.label}</span>
                  {count ? <span className={styles.itemCount}>{count}</span> : null}
                  <span className={styles.itemHint}>{d.hint}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}
