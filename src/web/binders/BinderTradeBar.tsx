import { useEffect, useId, useState } from "react";
import { useRepositories } from "../../app/contexts.tsx";
import { screenToPath } from "../../app/screenUrl.ts";
import { setForTrade, type Binder } from "../../models/binderLayout.ts";
import {
  BinderNotSyncedError,
  createTradeLink,
  findTradeLink,
  revokeTradeLink,
  type TradeLink,
} from "../../services/tradeShares.ts";
import styles from "./WebBinderScreen.module.css";

/**
 * Offering a binder for trade, and the link that does it.
 *
 * Two controls, deliberately not one. Marking a binder FOR TRADE turns on
 * copies and condition so it can be prepared — which is most of the work, and
 * happens before anyone is shown anything. SHARING mints the link. Rolling
 * them into a single button would mean the first card you counted was already
 * public, and there would be no way to stop showing a binder without also
 * losing the counts.
 *
 * Both are visible and neither has a hidden side effect. Revoking kills the
 * link and keeps the binder; un-marking for trade keeps every quantity, because
 * changing your mind about selling should not silently discard an afternoon of
 * counting.
 */
export function BinderTradeBar({ binder, onSave }: { binder: Binder; onSave: (binder: Binder) => void }) {
  const repo = useRepositories();
  const token = repo.getSyncSettings().token;

  const [link, setLink] = useState<TradeLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const labelId = useId();

  /**
   * Ask the server what is already shared.
   *
   * Without this, opening the binder on a second device offers "Share for
   * trade" for a binder that already has a live link — and pressing it would
   * look like it created one, while the old link stays out there unrevoked.
   * A failure here is silent on purpose: not knowing whether a link exists is
   * not an error the user can act on, and the button still works.
   */
  useEffect(() => {
    if (!token || !binder.forTrade) {
      setLink(null);
      return;
    }
    let cancelled = false;
    void findTradeLink(token, binder.id)
      .then((found) => {
        if (!cancelled) setLink(found);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token, binder.id, binder.forTrade]);

  const tradeUrl = (shareId: string) =>
    `${window.location.origin}${window.location.pathname}#${screenToPath({ name: "trade", shareId })}`;

  /** Hand the URL over the way the device does it best, and say that it worked. */
  const handOver = async (url: string) => {
    try {
      if (navigator.share) await navigator.share({ title: `${binder.name} — for trade`, url });
      else await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Cancelling the share sheet rejects, and that is not a failure.
    }
  };

  const share = async () => {
    if (!token) {
      setError("Connect this device to the server first — a trade link is served from there, not from here.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const created = link ?? (await createTradeLink(token, binder.id));
      setLink(created);
      await handOver(tradeUrl(created.id));
    } catch (err) {
      // The one failure with a fix the user can act on: the binder is still on
      // its way to the server, and waiting is the whole remedy.
      setError(
        err instanceof BinderNotSyncedError
          ? "This binder has not reached the server yet. It syncs on its own — try again in a moment."
          : "Could not reach the server to make a trade link.",
      );
    } finally {
      setBusy(false);
    }
  };

  const stopSharing = async () => {
    if (!token || !link) return;
    setError(null);
    setBusy(true);
    try {
      await revokeTradeLink(token, link.id);
      setLink(null);
    } catch {
      setError("Could not reach the server to stop sharing.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.settingRow}>
      <span className={styles.settingLabel} id={labelId}>
        Trading
      </span>
      <div className={styles.settingControls} role="group" aria-labelledby={labelId}>
        <button
          type="button"
          className={`${styles.chip} ${binder.forTrade ? styles.chipOn : ""}`}
          aria-pressed={Boolean(binder.forTrade)}
          onClick={() => onSave(setForTrade(binder, !binder.forTrade, Date.now()))}
        >
          {binder.forTrade ? "✓ For trade" : "For trade"}
        </button>

        {binder.forTrade ? (
          <>
            <button type="button" className={styles.chip} disabled={busy} onClick={() => void share()}>
              {copied ? "Link copied" : busy ? "Working…" : link ? "Copy trade link" : "Share for trade"}
            </button>
            {/* Only offered when there is something to stop. A "stop sharing"
                button on a binder that was never shared is a control that does
                nothing, which is how this codebase has been bitten before. */}
            {link ? (
              <button
                type="button"
                className={styles.chip}
                disabled={busy}
                onClick={() => void stopSharing()}
              >
                Stop sharing
              </button>
            ) : null}
          </>
        ) : null}

        {/* Inside the row, so the message sits under the buttons that caused it
            rather than at the foot of the whole panel. */}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
