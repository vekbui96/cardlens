import type { ReactNode } from "react";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useLibrary } from "../../app/LibraryProvider.tsx";
import { screenToPath } from "../../app/screenUrl.ts";
import { syncLine } from "../../features/collection/syncLine.ts";
import type { Screen } from "../../app/navigation.ts";
import type { UiVersion } from "../../app/uiVersion.ts";
import { VersionSwitch } from "./VersionSwitch.tsx";
import { cx } from "../primitives/index.ts";
import styles from "./V2Shell.module.css";

/**
 * The frame every v2 screen renders into.
 *
 * **The shell owns width.** Screens get their gutter from `.content` and never
 * set a page margin of their own — with nine screens being built in parallel
 * that is the only thing keeping their left edges on the same line. A screen
 * that genuinely wants a narrower column sets it on an inner element, inside
 * the gutter, where it reads as the local decision it is.
 */

interface Destination {
  label: string;
  screen: Screen;
  /** Screen names that should light this entry up, beyond its own. */
  also?: readonly Screen["name"][];
}

/**
 * The whole app, in the order someone actually moves through it. This is a row
 * of links, not a menu behind a button: on the web the destinations are cheap
 * to show and expensive to hunt for, which is the opposite of the glasses.
 */
const DESTINATIONS: readonly Destination[] = [
  { label: "Home", screen: { name: "home" } },
  // Sets and Collection are one screen — see specs/02-collection.md. Both
  // names route here, so both must mark this entry current.
  { label: "Collection", screen: { name: "collection" }, also: ["sets", "set", "owned"] },
  { label: "Search", screen: { name: "results", query: "" }, also: ["details"] },
  { label: "Scan", screen: { name: "scan" } },
  { label: "Binders", screen: { name: "binders" }, also: ["binder"] },
  { label: "Sealed", screen: { name: "sealed" } },
  { label: "Target", screen: { name: "target" } },
];

interface V2ShellProps {
  children: ReactNode;
  version: UiVersion;
}

export function V2Shell({ children, version }: V2ShellProps) {
  const { screen, push } = useNavigation();
  const { syncStatus } = useLibrary();
  const sync = syncLine(syncStatus);

  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#v2-main">
        Skip to content
      </a>

      <header className={styles.header}>
        <a
          className={styles.brand}
          href={`#${screenToPath({ name: "home" })}`}
          onClick={intercept(() => push({ name: "home" }))}
        >
          Card<span className={styles.brandMark}>Lens</span>
        </a>

        <nav className={styles.nav} aria-label="Main">
          {DESTINATIONS.map((d) => {
            const current = isCurrent(screen, d);
            return (
              <a
                key={d.label}
                className={cx(styles.navLink, current && styles.navLinkCurrent)}
                href={`#${screenToPath(d.screen)}`}
                {...(current ? { "aria-current": "page" as const } : {})}
                onClick={intercept(() => push(d.screen))}
              >
                {d.label}
              </a>
            );
          })}
        </nav>

        <div className={styles.headerEnd}>
          {/*
            Sync is a status, not an alert: a failed sync is not something the
            user has to act on right now, and it never becomes a toast. The
            three states that DO need words of their own — a rejected token, a
            server with sync switched off, and everything else — come from
            `syncLine`, shared with v1 so the two cannot drift apart.
          */}
          <span
            className={styles.navLink}
            title={sync.hint}
            aria-label={`${sync.label}. ${sync.hint}`}
            // Its text counts minutes against a real clock, so it differs
            // between snapshot runs for no reason a reviewer cares about.
            data-snapshot="volatile"
          >
            {sync.label}
          </span>
          <VersionSwitch current={version} />
        </div>
      </header>

      <main className={styles.content} id="v2-main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

function isCurrent(screen: Screen, d: Destination): boolean {
  if (screen.name === d.screen.name) return true;
  return d.also?.includes(screen.name) ?? false;
}

/**
 * Real `href`s, intercepted.
 *
 * The href has to be there — it is what makes a nav entry middle-clickable,
 * copyable, and readable as a link by assistive technology. But letting the
 * browser follow it would be a hash navigation the router then has to adopt
 * after the fact, so the modified clicks (new tab, new window, download) go to
 * the browser and a plain left click goes to the router.
 */
function intercept(run: () => void) {
  return (e: React.MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    run();
  };
}
