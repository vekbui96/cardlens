import { useEffect, useRef, useState, type FormEvent } from "react";
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
  screen: Screen;
}

const DESTINATIONS: Destination[] = [
  { label: "Sets", hint: "Browse and track sets", screen: { name: "sets" } },
  { label: "Collection", hint: "Progress through every set", screen: { name: "collection" } },
  { label: "My cards", hint: "Every printing you own, by price", screen: { name: "owned" } },
  { label: "Sealed prices", hint: "What packs and boxes cost now", screen: { name: "sealed" } },
  { label: "Favorites", hint: "Cards you starred", screen: { name: "favorites" } },
  { label: "Recent", hint: "Searches you made", screen: { name: "recent" } },
  { label: "Popular", hint: "Commonly searched Pokémon", screen: { name: "popular" } },
];

export function WebHeader() {
  const { push, home, screen } = useNavigation();
  const { collection, favorites, totalFinishesOwned } = useLibrary();
  const { run } = useSearchAction();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
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
    if (d.screen.name === "collection" && collection.length > 0) return String(collection.length);
    // Printings, not cards — the list below counts a normal and a reverse twice.
    if (d.screen.name === "owned" && totalFinishesOwned > 0) return String(totalFinishesOwned);
    if (d.screen.name === "favorites" && favorites.length > 0) return String(favorites.length);
    return null;
  };

  const go = (d: Destination) => {
    setOpen(false);
    push(d.screen);
  };

  const search = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setOpen(false);
    setQuery("");
    run(q);
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
          <div ref={panel} className={styles.panel} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            {/*
              Search is a field here, not a row that opens a modal. The panel is
              already open and already covering the screen, so sending the user
              to a second overlay to type one word is a step that buys nothing.

              Deliberately not autofocused: opening the menu to reach Collection
              should not raise the keyboard over the destinations you came for.
            */}
            <form className={styles.search} onSubmit={search} role="search">
              <input
                className={styles.searchInput}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search cards"
                aria-label="Search cards"
                enterKeyHint="search"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <button type="submit" className={styles.searchGo} disabled={!query.trim()}>
                Search
              </button>
            </form>

            <div className={styles.destinations} role="menu" aria-label="Go to">
              {DESTINATIONS.map((d) => {
                const count = countFor(d);
                const current = d.screen.name === screen.name;
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
        </div>
      ) : null}
    </>
  );
}
