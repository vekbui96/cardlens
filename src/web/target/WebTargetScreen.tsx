import { useState, type FormEvent } from "react";
import { useTargetBot } from "../../hooks/useTargetBot.ts";
import { extractTcin, statusLabel, type WatchedProduct } from "../../models/target.ts";
import { formatUpdated } from "../../utils/format.ts";
import styles from "./WebTargetScreen.module.css";

/**
 * The Target restock watchlist — what is being monitored, and what it found.
 *
 * Web only, like sealed prices: this is a table of products against statuses
 * plus text entry for a URL, and the glasses have neither the rows to spare on
 * a 600x600 additive display nor a keyboard to type a product link with.
 *
 * The bot itself is a separate process on the home server (see
 * server/targetBot.ts). Everything here is a view over its live state, so the
 * screen deliberately shows the bot's own health next to the products: a
 * watchlist where nothing has restocked and a watchlist that stopped checking
 * look identical otherwise.
 */
export function WebTargetScreen() {
  const bot = useTargetBot();
  const [entry, setEntry] = useState("");
  const [name, setName] = useState("");
  const [formError, setFormError] = useState("");

  function onAdd(event: FormEvent) {
    event.preventDefault();
    const tcin = extractTcin(entry);

    if (!tcin) {
      setFormError("Paste a Target product link or a TCIN (the digits after A- in the URL).");
      return;
    }

    setFormError("");
    bot.add.mutate(
      { target: entry.trim(), ...(name.trim() ? { name: name.trim() } : {}) },
      {
        onSuccess: () => {
          setEntry("");
          setName("");
        },
      },
    );
  }

  if (!bot.hasToken) {
    return <ConnectForm onConnect={bot.setToken} />;
  }

  const state = bot.state;
  const runtime = state?.runtime;
  const products = state?.products ?? [];
  const watched = products.filter((p) => !p.healthCheck);
  const inStock = watched.filter((p) => p.lastStatus === "IN_STOCK").length;

  return (
    <section className={styles.screen} aria-label="Target restock">
      <header className={styles.head}>
        <h2 className={styles.title}>Target restock</h2>
        <p className={styles.summary}>
          {bot.isLoading && !state
            ? "Reading the bot…"
            : `${watched.length} watched · ${inStock} in stock${
                runtime ? ` · store ${runtime.storeId}` : ""
              }`}
        </p>
      </header>

      {bot.error && !state ? (
        <div className={styles.notice}>
          <p className={styles.noticeText}>
            Could not reach the bot. Either the token is wrong, or the home server signed out — it drives a
            real browser window, which goes with the session.
          </p>
          <button type="button" className={styles.secondary} onClick={() => bot.setToken("")}>
            Change token
          </button>
        </div>
      ) : null}

      {runtime ? <RuntimePanel bot={bot} /> : null}

      <form className={styles.add} onSubmit={onAdd}>
        <h3 className={styles.sectionTitle}>Watch something new</h3>
        <input
          className={styles.input}
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
          placeholder="Target link or TCIN"
          aria-label="Target product link or TCIN"
          autoComplete="off"
        />
        <input
          className={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (optional — looked up if blank)"
          aria-label="Product name, optional"
          autoComplete="off"
        />
        <button type="submit" className={styles.primary} disabled={bot.add.isPending}>
          {/* Adding resolves the real title and a first status through the bot's
              browser, so it is seconds rather than instant. Say so. */}
          {bot.add.isPending ? "Checking with Target…" : "Add to watchlist"}
        </button>
        {formError ? <p className={styles.formError}>{formError}</p> : null}
        {bot.add.isError ? (
          <p className={styles.formError}>Could not add that — the bot refused or is unreachable.</p>
        ) : null}
      </form>

      {watched.length > 0 ? (
        <ul className={styles.list}>
          {products.map((product) => (
            <ProductRow key={product.tcin} product={product} bot={bot} />
          ))}
        </ul>
      ) : state ? (
        <p className={styles.empty}>Nothing on the watchlist yet.</p>
      ) : null}
    </section>
  );
}

/**
 * Its own token, entered per device.
 *
 * Not the collection token: these controls reach a browser that can add items
 * to a real Target cart, whereas the collection token lives on every device
 * that syncs cards. One device managing the watchlist is the whole point.
 */
function ConnectForm({ onConnect }: { onConnect: (token: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <section className={styles.screen} aria-label="Target restock">
      <header className={styles.head}>
        <h2 className={styles.title}>Target restock</h2>
        <p className={styles.summary}>This device is not connected to the bot yet.</p>
      </header>
      <form
        className={styles.add}
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onConnect(value);
        }}
      >
        <label className={styles.sectionTitle} htmlFor="target-token">
          Watchlist token
        </label>
        <input
          id="target-token"
          className={styles.input}
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="TARGET_TOKEN from the server"
          autoComplete="off"
        />
        <button type="submit" className={styles.primary} disabled={!value.trim()}>
          Connect
        </button>
        <p className={styles.meta}>
          Separate from the collection sync token on purpose — this one can add things to a Target cart.
        </p>
      </form>
    </section>
  );
}

type Bot = ReturnType<typeof useTargetBot>;

function RuntimePanel({ bot }: { bot: Bot }) {
  const runtime = bot.state?.runtime;
  if (!runtime) return null;

  // Ordered by how bad it is: a paused bot is a choice, a blocked or
  // browserless one is a fault, and all three mean nothing is being checked.
  const fault = !runtime.browserReady
    ? { tone: styles.bad, text: "Browser not ready — no checks are running" }
    : runtime.blocked
      ? {
          tone: styles.bad,
          text: `Blocked by Target — backing off ${runtime.blockBackoffSeconds}s`,
        }
      : runtime.paused
        ? { tone: styles.warn, text: "Paused" }
        : { tone: styles.good, text: "Running" };

  return (
    <div className={styles.runtime}>
      <div className={styles.runtimeTop}>
        <span className={`${styles.pill} ${fault.tone}`}>{fault.text}</span>
        <button
          type="button"
          className={styles.secondary}
          disabled={bot.setPaused.isPending}
          onClick={() => bot.setPaused.mutate(!runtime.paused)}
        >
          {runtime.paused ? "Resume" : "Pause"}
        </button>
      </div>
      <dl className={styles.stats}>
        <Stat
          label="Last sweep"
          value={runtime.lastCheckFinishedAt ? formatUpdated(runtime.lastCheckFinishedAt) : "In progress"}
        />
        <Stat label="Every" value={`${runtime.checkIntervalSeconds}s`} />
        <Stat label="Sweeps" value={String(runtime.checksCompleted)} />
        <Stat label="Up since" value={runtime.startedAt ? formatUpdated(runtime.startedAt) : "Unknown"} />
      </dl>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <dt className={styles.statLabel}>{label}</dt>
      <dd className={styles.statValue}>{value}</dd>
    </div>
  );
}

function ProductRow({ product, bot }: { product: WatchedProduct; bot: Bot }) {
  const checking = bot.checkNow.isPending && bot.checkNow.variables === product.tcin;
  const tone =
    product.lastStatus === "IN_STOCK"
      ? styles.good
      : product.lastStatus === "OUT"
        ? styles.neutral
        : styles.warn;

  return (
    <li className={`${styles.card} ${product.enabled ? "" : styles.disabled}`}>
      <div className={styles.cardTop}>
        <a className={styles.name} href={product.url} target="_blank" rel="noreferrer noopener">
          {product.name}
        </a>
        <span className={`${styles.pill} ${tone}`}>{statusLabel(product.lastStatus)}</span>
      </div>

      <p className={styles.meta}>
        {product.healthCheck ? "Health check · " : ""}
        {product.tcin} ·{" "}
        {product.lastCheckedAt ? `checked ${formatUpdated(product.lastCheckedAt)}` : "never checked"}
        {product.lastAlertedAt ? ` · alerted ${formatUpdated(product.lastAlertedAt)}` : ""}
      </p>

      <div className={styles.actions}>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={product.enabled}
            onChange={(e) => bot.update.mutate({ tcin: product.tcin, enabled: e.target.checked })}
          />
          Watching
        </label>

        {/* Auto-cart needs the hard Target login; without it the attempt fails
            at checkout rather than silently doing nothing, so it stays offerable. */}
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={product.autoCart}
            onChange={(e) => bot.update.mutate({ tcin: product.tcin, autoCart: e.target.checked })}
          />
          Auto-cart
        </label>

        <button
          type="button"
          className={styles.secondary}
          disabled={checking}
          onClick={() => bot.checkNow.mutate(product.tcin)}
        >
          {checking ? "Checking…" : "Check now"}
        </button>

        {product.healthCheck ? null : (
          <button
            type="button"
            className={styles.danger}
            disabled={bot.remove.isPending}
            onClick={() => bot.remove.mutate(product.tcin)}
          >
            Remove
          </button>
        )}
      </div>
    </li>
  );
}
