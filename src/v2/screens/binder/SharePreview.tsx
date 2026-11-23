import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { ErrorNotice } from "../../primitives/index.ts";
import { useRepositories } from "../../../app/contexts.tsx";
import { screenToPath } from "../../../app/screenUrl.ts";
import type { Binder } from "../../../models/binderLayout.ts";
import { BinderNotSyncedError, createTradeLink } from "../../../services/tradeShares.ts";
import { copyLink } from "../../../web/handOverLink.ts";
import { LinkFallback } from "../../../web/LinkFallback.tsx";
import { BinderShowcaseView } from "../share/TradeShareScreen.tsx";
import styles from "./binder.module.css";

interface SharePreviewProps {
  binder: Binder;
  onClose: () => void;
  /** Where focus goes back to when the preview closes: the Share button. */
  returnFocus: RefObject<HTMLElement | null>;
}

type CopyState =
  { kind: "idle" } | { kind: "busy" } | { kind: "copied" } | { kind: "error"; message: string };

/**
 * Share, previewed: the page a visitor will land on, before the link goes out.
 *
 * The body is the visitor page itself (`BinderShowcaseView`), drawn from the
 * binder on this device, so the owner looks at the same component the link
 * opens rather than a lookalike. Nothing is asked of the server until "Copy
 * link" is pressed: looking is free, and backing out leaves no link behind.
 *
 * Copy link is the existing share action, unchanged: `createTradeLink` (the
 * server reuses a binder's live link rather than minting a second one) and the
 * same `#/trade/<id>` address the legacy Share for trade button builds. A
 * clipboard that refuses puts the link on screen; a failure uses the shared
 * ErrorNotice. The tab title is left alone — this is still the Binder screen.
 */
export function SharePreview({ binder, onClose, returnFocus }: SharePreviewProps) {
  const repo = useRepositories();
  const [state, setState] = useState<CopyState>({ kind: "idle" });
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    const back = returnFocus.current;
    dialogRef.current?.focus();
    return () => back?.focus?.();
  }, [returnFocus]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // A card opened large is its own dialog inside this one, with its own
      // Escape and focus trap; leave the keys to it while it is up.
      if (dialogRef.current?.querySelector('[role="dialog"]')) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input, textarea") ?? [],
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement;
      const inside = dialogRef.current?.contains(active) ?? false;
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const copy = async () => {
    const token = repo.getSyncSettings().token;
    if (!token) {
      setState({
        kind: "error",
        message: "Connect this device to the server first: a share link is served from there, not from here.",
      });
      return;
    }
    setState({ kind: "busy" });
    setFallbackUrl(null);
    try {
      const link = await createTradeLink(token, binder.id);
      const url = `${window.location.origin}${window.location.pathname}#${screenToPath({
        name: "trade",
        shareId: link.id,
      })}`;
      if (await copyLink(url)) {
        setState({ kind: "copied" });
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setState({ kind: "idle" }), 2500);
      } else {
        // The mint can outlast the tap's permission to write the clipboard; the
        // link goes on screen, where a fresh tap on its own Copy has it.
        setFallbackUrl(url);
        setState({ kind: "idle" });
      }
    } catch (err) {
      setState({
        kind: "error",
        message:
          err instanceof BinderNotSyncedError
            ? "This binder has not reached the server yet. It syncs on its own, so try again in a moment."
            : "Could not reach the server to make a share link.",
      });
    }
  };

  const busy = state.kind === "busy";

  return (
    <div
      className={styles.sharePreview}
      role="dialog"
      aria-modal="true"
      aria-label={`What a visitor sees: ${binder.name}`}
      tabIndex={-1}
      ref={dialogRef}
    >
      <div className={styles.shareHead}>
        <h2 className={styles.showTitle}>What a visitor sees</h2>
        <div className={styles.shareActions}>
          <button type="button" className={styles.button} onClick={onClose}>
            Back
          </button>
          <button type="button" className={styles.button} disabled={busy} onClick={() => void copy()}>
            {busy ? "Working…" : state.kind === "copied" ? "Link copied" : "Copy link"}
          </button>
        </div>
      </div>

      {state.kind === "error" ? <ErrorNotice onRetry={() => void copy()}>{state.message}</ErrorNotice> : null}
      {fallbackUrl ? <LinkFallback url={fallbackUrl} label="Share link" /> : null}

      <div className={styles.shareBody} data-testid="share-preview-body">
        <BinderShowcaseView binder={binder} />
      </div>
    </div>
  );
}
