import type { ReactNode } from "react";
import { ErrorNotice } from "../../primitives/index.ts";
import { formatUpdated } from "../../../utils/format.ts";
import styles from "./share.module.css";

/**
 * The chrome every share page wears.
 *
 * Kept in one place because the three pages must fail IDENTICALLY. A revoked
 * link and a link that never existed have to be indistinguishable, and the
 * quickest way for that to stop being true is three screens each writing their
 * own "not found".
 */

export function ShareLoading({ what }: { what: string }) {
  return (
    <div className={styles.skeleton} aria-busy="true" aria-live="polite">
      <span className={styles.srOnly}>Loading {what}</span>
      <div className={styles.skeletonBar} />
      <div className={styles.skeletonGrid}>
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} className={styles.skeletonCard} />
        ))}
      </div>
    </div>
  );
}

/**
 * The one failure page.
 *
 * It says nothing about WHY, on purpose. The server does not distinguish a
 * revoked id from one that never existed, and a page that did would tell a
 * stranger which ids were once real.
 */
export function ShareGone({ onRetry }: { onRetry: () => void }) {
  return (
    <ErrorNotice title="This link doesn't work" onRetry={onRetry}>
      It may have been turned off by whoever sent it, or it may never have been a link at all. Either way
      there is nothing here to show you. Ask whoever sent it for a new link.
    </ErrorNotice>
  );
}

/** True when the browser says there is no connection at all. */
export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * The visitor has no connection, which says nothing about the link.
 *
 * Kept apart from `ShareGone` because the next step is different: a dead link
 * needs a new one from the sender, an offline phone only needs a signal.
 */
export function ShareOffline({ onRetry }: { onRetry: () => void }) {
  return (
    <ErrorNotice title="You're offline" onRetry={onRetry}>
      This page needs a connection to load the cards. Nothing is wrong with the link: reconnect and try again.
    </ErrorNotice>
  );
}

interface ShareHeaderProps {
  title: string;
  /** What this page is, in one line, for someone who has never seen the app. */
  subtitle: ReactNode;
  /** Server clock from the share, when it is a live one. */
  updatedAt?: number | undefined;
  aside?: ReactNode;
}

export function ShareHeader({ title, subtitle, updatedAt, aside }: ShareHeaderProps) {
  return (
    <header className={styles.header}>
      <div>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.subtitle}>
          {subtitle}
          {updatedAt !== undefined ? (
            <>
              {/*
                Its own clock, not the viewer's idea of now: a live share is
                whatever the server last said, and saying "just now" about a
                page that has been open for an hour is a lie. The separator
                sits inside the volatile span so a masked screenshot does not
                end on a dangling "·".
              */}
              <span data-snapshot="volatile">
                {" · "}
                {formatUpdated(new Date(updatedAt).toISOString())}
              </span>
            </>
          ) : null}
        </p>
      </div>
      {aside}
    </header>
  );
}
