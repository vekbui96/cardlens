import { useState, type ReactNode } from "react";
import styles from "./primitives.module.css";
import { Panel } from "./surfaces.tsx";
import { Stack } from "./layout.tsx";

interface ErrorNoticeProps {
  /** What failed, in a sentence or two. Never blames the person's input. */
  children: ReactNode;
  /** A heading. Without one the notice is a bordered block that sits inside another panel. */
  title?: string;
  /** One sentence saying what still works, so a partial failure does not read as a total one. */
  stillWorks?: string;
  /** A retry is in flight: the button reads "Trying again…" and cannot be pressed twice. */
  busy?: boolean;
  onRetry: () => void;
  headingLevel?: 2 | 3 | 4;
}

/**
 * The one way a v2 screen says "that did not load, and here is the retry".
 *
 * Screens used to hand-roll this block, each with its own button style and its
 * own busy label. One wording ("Try again" / "Trying again…") and one 44px
 * target means a failed Search and a failed card sheet look and behave alike.
 * It changes no fetch or retry policy: the caller owns `onRetry` and `busy`.
 *
 * Screen readers. A notice only ever mounts in place of a loading state, after
 * the person searched or opened a card, so it is announced: the heading and the
 * sentences sit in a `role="alert"` region (assertive and atomic already; no
 * extra `aria-live`, which would announce twice). The button stays OUTSIDE the
 * region, or every announcement would end in "Try again, button".
 *
 * A retry that fails again changes no text, and an unchanged live region says
 * nothing — the person pressed Try again and heard silence. So when `busy`
 * falls back to false with the notice still up, the region is remounted (same
 * pixels, new node) and announced afresh.
 *
 * The button uses `aria-disabled`, not `disabled`, while busy: disabling the
 * focused element drops focus to `<body>`, and keyboard and screen-reader users
 * would lose their place at the moment they asked for something.
 */
export function ErrorNotice({
  children,
  title,
  stillWorks,
  busy = false,
  onRetry,
  headingLevel = 2,
}: ErrorNoticeProps) {
  const attempts = useFailedRetries(busy);
  const Heading = `h${headingLevel}` as const;
  const message = (
    <Stack gap={3}>
      <p className={styles.noticeText}>{children}</p>
      {stillWorks ? <p className={styles.noticeText}>{stillWorks}</p> : null}
    </Stack>
  );
  const body = (
    <Stack gap={3}>
      <div key={attempts} role="alert">
        {title !== undefined ? (
          // Panel's own header markup, rendered here so the heading is inside the
          // alert region with the sentences it introduces.
          <div className={styles.panelHeader}>
            <Heading className={styles.panelTitle}>{title}</Heading>
          </div>
        ) : null}
        {message}
      </div>
      <div>
        <button
          type="button"
          className={styles.noticeRetry}
          onClick={busy ? undefined : onRetry}
          aria-disabled={busy || undefined}
        >
          {busy ? "Trying again…" : "Try again"}
        </button>
      </div>
    </Stack>
  );
  if (title !== undefined) {
    return <Panel tone="raised">{body}</Panel>;
  }
  return <div className={styles.noticeBox}>{body}</div>;
}

/** Counts retries that finished with the notice still mounted, i.e. failed again. */
function useFailedRetries(busy: boolean): number {
  // State adjusted during render (React's documented "previous prop" pattern),
  // so the remount lands in the same commit as the button going back to "Try again".
  const [wasBusy, setWasBusy] = useState(busy);
  const [count, setCount] = useState(0);
  if (wasBusy !== busy) {
    setWasBusy(busy);
    if (wasBusy && !busy) setCount(count + 1);
  }
  return count;
}
