import { useState, type FormEvent, type ReactNode } from "react";
import { useTargetBot } from "../../../hooks/useTargetBot.ts";
import { extractTcin, statusLabel, type WatchedProduct } from "../../../models/target.ts";
import { formatUpdated } from "../../../utils/format.ts";
import { Card, Chip, cx, Panel, Row, ScreenReaderOnly, Stack } from "../../primitives/index.ts";
import { addProblem, botHealth, botTrouble, checkProblem, statusTone } from "./botState.ts";
import styles from "./target.module.css";

/**
 * The Target restock watchlist — what is being watched, and whether anything is
 * actually watching it.
 *
 * This screen is mostly STATES. The thing it is a client of lives on another
 * machine, in a signed-in session, and stops on its own: the bot is a scheduled
 * task driving a headed browser (PerimeterX challenges a headless one), so
 * "SERVER-PC signed out" is a Tuesday, not an incident. Every failure path here
 * is therefore worded as a fact about the bot rather than as an app error —
 * see `botState.ts`, where those words are decided and tested.
 *
 * The token is `TARGET_TOKEN` and NOT the collection sync token. They are kept
 * apart in storage by `Repositories.getTargetSettings` / `setTargetSettings`
 * ("target-settings", never "sync-settings"), and this screen only ever reaches
 * them through `useTargetBot`, which is the single reader. The reason is blast
 * radius: the collection token is entered on every device that syncs cards and
 * can only move card rows, while these routes reach a browser that can put
 * items in a real Target cart. Neither ever goes in a `VITE_` variable — this
 * ships as a static bundle, so anything baked in at build time is public.
 */
export function TargetScreen() {
  const bot = useTargetBot();
  return bot.hasToken ? <Watchlist bot={bot} /> : <Connect onConnect={bot.setToken} />;
}

type Bot = ReturnType<typeof useTargetBot>;

function Head({ children }: { children?: ReactNode }) {
  return (
    <header>
      <h1 className={styles.h1}>Target restock</h1>
      {children}
    </header>
  );
}

/* --- No token ------------------------------------------------------------- */

/**
 * Entered once per device, and deliberately not shared with anything else.
 *
 * A screen with no token is not a broken screen — it is a screen that has not
 * been given the one thing it needs, so it says which thing, where it comes
 * from, and why it is not the token this device may already have.
 */
function Connect({ onConnect }: { onConnect: (token: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <Stack gap={5}>
      <Head>
        <p className={styles.lead}>This device is not connected to the watchlist bot yet.</p>
      </Head>

      <Panel title="Connect this device" tone="raised" className={styles.column}>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (value.trim()) onConnect(value);
          }}
        >
          <Stack gap={3}>
            <label className={styles.label} htmlFor="v2-target-token">
              Watchlist token
            </label>
            <input
              id="v2-target-token"
              className={styles.input}
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="TARGET_TOKEN from the server"
              autoComplete="off"
            />
            <Row gap={2}>
              <button
                type="submit"
                className={cx(styles.button, styles.buttonPrimary)}
                disabled={!value.trim()}
              >
                Connect
              </button>
            </Row>
            <p className={styles.note}>
              This is <strong>TARGET_TOKEN</strong>, set on the server — not the collection sync token, and
              not interchangeable with it. They are separate on purpose: the sync token is on every device
              that holds cards and can only move card rows, while this one reaches a browser that can put
              items in a real Target cart.
            </p>
          </Stack>
        </form>
      </Panel>
    </Stack>
  );
}

/* --- Connected ------------------------------------------------------------ */

function Watchlist({ bot }: { bot: Bot }) {
  const state = bot.state;
  const products = state?.products ?? [];
  const watched = products.filter((p) => !p.healthCheck);
  const inStock = products.filter((p) => p.lastStatus === "IN_STOCK").length;

  // A failure only takes the screen over when there is nothing good to show.
  // With a watchlist already on screen, a blip is a line of text — blanking
  // twelve products because one poll failed is worse than saying it failed.
  const trouble = !state && bot.error ? botTrouble(bot.error) : null;
  const stale = state && bot.error ? botTrouble(bot.error) : null;

  return (
    <Stack gap={5}>
      <Head>
        <p className={styles.lead}>
          {state
            ? `${watched.length} watched · ${inStock} in stock${
                state.runtime.storeId ? ` · store ${state.runtime.storeId}` : ""
              }`
            : trouble
              ? "The watchlist could not be read."
              : "Reading the bot…"}
        </p>
      </Head>

      {trouble ? <Trouble trouble={trouble} bot={bot} /> : null}
      {!state && !trouble ? <Loading /> : null}

      {state ? (
        <>
          <Health bot={bot} />
          {stale ? (
            <p className={styles.note} role="status">
              The last read of the bot did not come back — {stale.title.toLowerCase()}. What is below is the
              last state it reported.
            </p>
          ) : null}
          <AddForm bot={bot} />
          <Products bot={bot} products={products} watched={watched.length} />
        </>
      ) : null}
    </Stack>
  );
}

/**
 * The failure states, in the bot's own terms.
 *
 * Not an error box. "Failed to load" would be true of all four of these and
 * useful for none of them: one needs a different token, one needs someone to
 * sign back in to the home server, one is the network, and one is a genuine
 * surprise.
 */
function Trouble({ trouble, bot }: { trouble: ReturnType<typeof botTrouble>; bot: Bot }) {
  return (
    <Panel tone="raised" className={styles.column}>
      <Stack gap={3}>
        <h2 className={styles.troubleTitle}>{trouble.title}</h2>
        <p>{trouble.detail}</p>
        <Row gap={2} wrap>
          <button
            type="button"
            className={cx(styles.button, styles.buttonPrimary)}
            onClick={() => (trouble.action.kind === "retry" ? bot.refetch() : bot.setToken(""))}
          >
            {trouble.action.label}
          </button>
          {trouble.action.kind === "retry" ? (
            <button type="button" className={styles.button} onClick={() => bot.setToken("")}>
              Change token
            </button>
          ) : null}
        </Row>
      </Stack>
    </Panel>
  );
}

/** A skeleton shaped like the screen, not a spinner on an empty page. */
function Loading() {
  return (
    <Stack gap={4} aria-busy="true">
      <ScreenReaderOnly>Reading the bot</ScreenReaderOnly>
      <div className={cx(styles.bar, styles.barTall)} />
      <div className={styles.bar} />
      <div className={styles.bar} />
    </Stack>
  );
}

/**
 * Whether anything is actually checking, and how long since it last did.
 *
 * Shown even when the bot answers happily: a watchlist where nothing has
 * restocked and one that quietly stopped sweeping look identical otherwise.
 */
function Health({ bot }: { bot: Bot }) {
  const runtime = bot.state?.runtime;
  if (!runtime) return null;
  const health = botHealth(runtime);

  return (
    <Panel
      title="The bot"
      aside={
        <button
          type="button"
          className={styles.button}
          disabled={bot.setPaused.isPending}
          onClick={() => bot.setPaused.mutate(!runtime.paused)}
        >
          {runtime.paused ? "Resume" : "Pause"}
        </button>
      }
    >
      <Stack gap={3}>
        <Row gap={2} wrap>
          <Chip tone={health.tone}>{health.label}</Chip>
          <span className={styles.note}>{health.note}</span>
        </Row>
        <Row gap={5} wrap>
          <Fact
            label="Last sweep"
            value={runtime.lastCheckFinishedAt ? formatUpdated(runtime.lastCheckFinishedAt) : "In progress"}
            volatile
          />
          <Fact label="Sweeps done" value={String(runtime.checksCompleted)} />
          <Fact
            label="Up since"
            value={runtime.startedAt ? formatUpdated(runtime.startedAt) : "Unknown"}
            volatile
          />
        </Row>
      </Stack>
    </Panel>
  );
}

/**
 * `volatile` marks a figure that counts minutes against a real clock, so the
 * visual snapshots hide it rather than re-baselining every time one ticks over.
 */
function Fact({ label, value, volatile: isVolatile }: { label: string; value: string; volatile?: boolean }) {
  return (
    <Stack gap={1}>
      <span className={styles.label}>{label}</span>
      <span {...(isVolatile ? { "data-snapshot": "volatile" } : {})}>{value}</span>
    </Stack>
  );
}

/* --- Adding --------------------------------------------------------------- */

function AddForm({ bot }: { bot: Bot }) {
  const [entry, setEntry] = useState("");
  const [name, setName] = useState("");
  const [rejected, setRejected] = useState("");
  const [added, setAdded] = useState("");

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    // Checked here rather than by the bot: a typo should not cost a 30s round
    // trip through a real browser to be told it was a typo.
    const tcin = extractTcin(entry);
    if (!tcin) {
      setRejected("Paste a Target product link, or the TCIN on its own — the digits after A- in the URL.");
      return;
    }
    setRejected("");
    setAdded("");
    const label = name.trim();
    bot.add.mutate(
      { target: entry.trim(), ...(label ? { name: label } : {}) },
      {
        onSuccess: () => {
          setAdded(`Added ${label || `TCIN ${tcin}`} to the watchlist.`);
          setEntry("");
          setName("");
        },
      },
    );
  }

  return (
    <Panel title="Watch something new" className={styles.column} headingLevel={2}>
      <form onSubmit={onSubmit}>
        <Stack gap={3}>
          <label className={styles.label} htmlFor="v2-target-entry">
            Target link or TCIN
          </label>
          <input
            id="v2-target-entry"
            className={styles.input}
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
            placeholder="https://www.target.com/p/…/-/A-94336414"
            autoComplete="off"
          />

          <label className={styles.label} htmlFor="v2-target-name">
            Name (optional — the bot looks it up if blank)
          </label>
          <input
            id="v2-target-name"
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />

          <Row gap={3} wrap>
            <button
              type="submit"
              className={cx(styles.button, styles.buttonPrimary)}
              disabled={bot.add.isPending}
            >
              {/* Adding resolves the real title and a first status through the
                  bot's warmed browser, so it is seconds, not instant. Say so
                  rather than looking hung. */}
              {bot.add.isPending ? "Checking with Target…" : "Add to watchlist"}
            </button>
            {bot.add.isPending ? (
              <span className={styles.note}>Driving the bot&rsquo;s browser — 15–30 seconds.</span>
            ) : null}
          </Row>

          {rejected ? <p className={styles.problem}>{rejected}</p> : null}
          {bot.add.isError ? (
            <p className={styles.problem} role="alert">
              {addProblem(bot.add.error)}
            </p>
          ) : null}
          {/*
            The confirmation is the acceptance criterion: an add that takes half
            a minute and then says nothing is indistinguishable from one that
            silently failed.
          */}
          <p className={styles.confirmed} role="status">
            {added}
          </p>
        </Stack>
      </form>
    </Panel>
  );
}

/* --- The list ------------------------------------------------------------- */

function Products({ bot, products, watched }: { bot: Bot; products: WatchedProduct[]; watched: number }) {
  if (products.length === 0) {
    return (
      <Panel title="Watchlist" className={styles.column}>
        <p className={styles.note}>
          Nothing on the watchlist yet. Paste a Target product link above and the bot starts checking it on
          its next sweep.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="Watchlist" aside={<Chip>{`${watched} watched`}</Chip>}>
      <Stack as="ul" gap={3} className={styles.list}>
        {products.map((product) => (
          <li key={product.tcin}>
            <ProductRow product={product} bot={bot} />
          </li>
        ))}
      </Stack>
    </Panel>
  );
}

/**
 * One product.
 *
 * An inert `Card`: it holds a link and four controls, and a surface that looks
 * pressable and is not is how a UI lies. The controls carry the product name in
 * their accessible names, because "Remove" said twelve times is twelve
 * identical buttons to anyone not looking at the screen.
 */
function ProductRow({ product, bot }: { product: WatchedProduct; bot: Bot }) {
  const checking = bot.checkNow.isPending && bot.checkNow.variables === product.tcin;
  const removing = bot.remove.isPending && bot.remove.variables === product.tcin;

  return (
    <Card>
      <Stack gap={2}>
        <Row gap={3} justify="space-between" align="start" wrap>
          <a className={styles.name} href={product.url} target="_blank" rel="noreferrer noopener">
            {product.name}
          </a>
          <Chip tone={statusTone(product.lastStatus)}>{statusLabel(product.lastStatus)}</Chip>
        </Row>

        <p className={styles.meta}>
          {product.healthCheck ? "Health check · " : ""}TCIN {product.tcin}
          {/* The separator rides INSIDE the volatile span: the snapshot run
              hides that span, and a dangling "·" in a baseline reads as a bug. */}
          <span data-snapshot="volatile">
            {" · "}
            {product.lastCheckedAt ? `checked ${formatUpdated(product.lastCheckedAt)}` : "never checked"}
          </span>
        </p>

        <Row gap={3} wrap>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={product.enabled}
              aria-label={`Watching ${product.name}`}
              onChange={(e) => bot.update.mutate({ tcin: product.tcin, enabled: e.target.checked })}
            />
            Watching
          </label>

          {/* Auto-cart needs the hard Target login, and fails at checkout rather
              than silently doing nothing without it — so it stays offerable. */}
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={product.autoCart}
              aria-label={`Auto-cart ${product.name}`}
              onChange={(e) => bot.update.mutate({ tcin: product.tcin, autoCart: e.target.checked })}
            />
            Auto-cart
          </label>

          <button
            type="button"
            className={styles.button}
            disabled={checking}
            aria-label={`Check ${product.name} now`}
            onClick={() => bot.checkNow.mutate(product.tcin)}
          >
            {checking ? "Checking…" : "Check now"}
          </button>

          {/* The bot's own canary, kept permanently in stock so a silent
              watchlist can be told from a broken checker. Not the user's to
              remove, so no button pretends otherwise. */}
          {product.healthCheck ? null : (
            <button
              type="button"
              className={cx(styles.button, styles.buttonDanger)}
              disabled={removing}
              aria-label={`Remove ${product.name}`}
              onClick={() => bot.remove.mutate(product.tcin)}
            >
              {removing ? "Removing…" : "Remove"}
            </button>
          )}
        </Row>

        {bot.checkNow.isError && bot.checkNow.variables === product.tcin ? (
          <p className={styles.problem} role="alert">
            {checkProblem(bot.checkNow.error)}
          </p>
        ) : null}
      </Stack>
    </Card>
  );
}
