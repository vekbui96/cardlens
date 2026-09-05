import { Panel, Row, Stack } from "../../primitives/index.ts";
import { useTargetBot } from "../../../hooks/useTargetBot.ts";
import { AddWatch } from "./AddWatch.tsx";
import { BotHealth } from "./BotHealth.tsx";
import { ConnectPanel } from "./ConnectPanel.tsx";
import { WatchRow } from "./WatchRow.tsx";
import { botFailure, watchSummary, type BotFailure } from "./targetState.ts";
import styles from "./target.module.css";

/**
 * Target restock: what is being watched, and whether anything is watching.
 *
 * ## Why the failure states are most of this file
 *
 * The bot is not a service. It is a scheduled task inside an INTERACTIVE
 * session on a home server, driving a headed Playwright browser through
 * PerimeterX — so it stops when that machine signs out, and that happens. A
 * screen that renders "Failed to load" for it is a screen that reports a normal
 * Tuesday as an app error, and one that renders an empty watchlist is worse: a
 * watchlist where nothing has restocked and a watchlist that stopped checking
 * are indistinguishable unless somebody says which.
 *
 * So three things are non-negotiable here, and `targetState.ts` decides all
 * three: what could not be reached (never the reader's fault), how old what we
 * ARE showing is (every status carries its own age), and a way to ask again.
 *
 * ## The request budget
 *
 * One `GET /api/target/state` on mount and one every 30s after, from
 * `useTargetBot` — half the bot's own ~60s sweep, so a restock is visible within
 * a sweep without polling a browser-driven backend harder than it works. This
 * screen does not shorten that interval and adds no second query: retrying is an
 * invalidation of the SAME key, and every mutation invalidates it rather than
 * fetching alongside it.
 *
 * ## The token
 *
 * `TARGET_TOKEN`, held under `target-settings`, never `sync-settings`. These
 * routes can put real items in a real Target cart; the collection token is on
 * every device that syncs cards. Nothing in this directory reads or writes the
 * collection token's key — see `ConnectPanel`.
 */
export function TargetScreen() {
  const bot = useTargetBot();

  if (!bot.hasToken) {
    return <ConnectPanel onConnect={bot.setToken} />;
  }

  const state = bot.state;
  const runtime = state?.runtime ?? null;
  const products = state?.products ?? [];
  const failure = botFailure(bot.error);
  const summary = watchSummary(products);
  const loading = bot.isLoading && !state;

  return (
    <Stack gap={5}>
      <header>
        <h1 className={styles.title}>Target restock</h1>
        <p className={styles.summary}>
          {loading ? "Reading the bot…" : state ? summary.line : "The watchlist cannot be read right now."}
        </p>
      </header>

      {failure ? (
        <FailureNotice
          failure={failure}
          showingOldData={Boolean(state)}
          onRetry={bot.refetch}
          onForgetToken={() => bot.setToken("")}
        />
      ) : null}

      {loading ? <Skeleton /> : null}

      {runtime ? (
        <BotHealth
          runtime={runtime}
          pausing={bot.setPaused.isPending}
          onSetPaused={(paused) => bot.setPaused.mutate(paused)}
        />
      ) : null}

      <AddWatch
        pending={bot.add.isPending}
        error={bot.add.error}
        blocked={
          failure && !state
            ? "Nothing can be added until the bot answers — this is a live lookup through its browser, not a row written locally."
            : null
        }
        onAdd={(input, done) => bot.add.mutate(input, { onSuccess: done })}
      />

      {state ? (
        <Panel title="Watchlist" headingLevel={2}>
          {products.length > 0 ? (
            <ul className={styles.list}>
              {products.map((product) => (
                <WatchRow key={product.tcin} product={product} runtime={runtime} bot={bot} />
              ))}
            </ul>
          ) : (
            /*
              An empty watchlist is not a dead end: the form that fixes it is
              directly above, and this says so rather than leaving a blank panel
              under a heading.
            */
            <p className={styles.prose}>
              Nothing is being watched yet. Paste a Target product link above and the bot will check it on
              every sweep, and tell you the moment it comes back in stock.
            </p>
          )}
        </Panel>
      ) : null}

      <Row gap={3} wrap>
        <button type="button" className={styles.secondary} onClick={() => bot.setToken("")}>
          Disconnect this device
        </button>
      </Row>
    </Stack>
  );
}

/**
 * What could not be reached, and what to do about it.
 *
 * Two things it must never do: blame the reader, and hide that the products
 * underneath are what the bot said LAST time. When there is still data on
 * screen this says so plainly — a failure notice above live-looking rows, with
 * no word about which, is the worst of both.
 */
function FailureNotice({
  failure,
  showingOldData,
  onRetry,
  onForgetToken,
}: {
  failure: BotFailure;
  showingOldData: boolean;
  onRetry: () => void;
  onForgetToken: () => void;
}) {
  return (
    <Panel
      className={styles.failure}
      headingLevel={2}
      title={<span className={styles.failureTitle}>{failure.title}</span>}
    >
      <Stack gap={3}>
        <p className={styles.prose}>{failure.detail}</p>

        {showingOldData ? (
          <p className={styles.prose}>
            Everything below is what the bot reported the last time it answered, not what it says now. Each
            row carries the time of its own last check.
          </p>
        ) : null}

        <Row gap={2} wrap>
          {failure.retryable ? (
            <button type="button" className={styles.secondary} onClick={onRetry}>
              Try the bot again
            </button>
          ) : null}
          {failure.tokenAtFault ? (
            <button type="button" className={styles.secondary} onClick={onForgetToken}>
              Enter a different token
            </button>
          ) : null}
        </Row>
      </Stack>
    </Panel>
  );
}

/**
 * The shape of the content, not a spinner: a health panel and three rows, which
 * is what a small watchlist looks like, so nothing jumps when it arrives.
 */
function Skeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <Stack gap={3}>
        <span className={styles.label}>Reading the watchlist</span>
        <div className={styles.skeletonRow} />
        <div className={styles.skeletonRow} />
        <div className={styles.skeletonRow} />
      </Stack>
    </div>
  );
}
