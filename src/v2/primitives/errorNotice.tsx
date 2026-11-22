import type { ReactNode } from "react";
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
 */
export function ErrorNotice({
  children,
  title,
  stillWorks,
  busy = false,
  onRetry,
  headingLevel = 2,
}: ErrorNoticeProps) {
  const body = (
    <Stack gap={3}>
      <p className={styles.noticeText}>{children}</p>
      {stillWorks ? <p className={styles.noticeText}>{stillWorks}</p> : null}
      <div>
        <button type="button" className={styles.noticeRetry} onClick={onRetry} disabled={busy}>
          {busy ? "Trying again…" : "Try again"}
        </button>
      </div>
    </Stack>
  );
  if (title !== undefined) {
    return (
      <Panel title={title} headingLevel={headingLevel} tone="raised">
        {body}
      </Panel>
    );
  }
  return <div className={styles.noticeBox}>{body}</div>;
}
