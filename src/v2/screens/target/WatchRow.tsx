import { Card, Chip, Row, ScreenReaderOnly, Stack, cx } from "../../primitives/index.ts";
import type { BotRuntime, WatchedProduct } from "../../../models/target.ts";
import type { CartTestResult, useTargetBot } from "../../../hooks/useTargetBot.ts";
import { watchStatus, type Tone } from "./targetState.ts";
import styles from "./target.module.css";

type Bot = ReturnType<typeof useTargetBot>;

/**
 * One watched product.
 *
 * The status word and its AGE are printed as one fact, always. "In stock" on its
 * own is a claim about right now that this page cannot support — it is a cache
 * of a sweep that may have run hours ago — and when the age is past the bot's
 * own cadence the row says the status describes the past, in words, rather than
 * leaving the reader to do the subtraction.
 */
export function WatchRow({
  product,
  runtime,
  bot,
}: {
  product: WatchedProduct;
  runtime: BotRuntime | null;
  bot: Bot;
}) {
  const status = watchStatus(product, runtime);
  const checking = bot.checkNow.isPending && bot.checkNow.variables === product.tcin;
  const carting = bot.testCart.isPending && bot.testCart.variables === product.tcin;
  const mine = bot.testCart.variables === product.tcin;
  const cartResult = mine ? bot.testCart.data : undefined;
  const cartFailed = mine && bot.testCart.isError;

  return (
    <li className={cx(!product.enabled && styles.rowOff)}>
      <Card pad={4}>
        <Stack gap={3}>
          <Row gap={3} justify="space-between" align="start" wrap>
            <h3 className={styles.rowHeading}>
              <a className={styles.productName} href={product.url} target="_blank" rel="noreferrer noopener">
                {product.name}
              </a>
            </h3>
            <Chip tone={chipTone(status.tone)}>{status.word}</Chip>
          </Row>

          {/*
            Counts real minutes against a real clock, so it is hidden from
            visual baselines — otherwise a snapshot taken today fails tomorrow
            for saying something true.
          */}
          <p className={cx(styles.meta, status.stale && styles.metaStale)} data-snapshot="volatile">
            {product.healthCheck ? "The bot's own canary · " : ""}
            TCIN {product.tcin} · {status.checked}
            {product.lastAlertedAt ? ` · alerted ${product.lastAlertedAt.slice(0, 10)}` : ""}
            {status.stale
              ? " — that is older than the bot's own sweep interval, so this is what it WAS, not what it is."
              : ""}
            {product.enabled ? "" : " — not being watched, so it is not being checked at all."}
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

            {/*
              Auto-cart spends real money if it fires, so it is never hidden
              behind a menu and its label says what it does rather than being
              an icon.
            */}
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={product.autoCart}
                onChange={(e) => bot.update.mutate({ tcin: product.tcin, autoCart: e.target.checked })}
              />
              Add to cart automatically
            </label>

            <button
              type="button"
              className={styles.secondary}
              disabled={checking}
              onClick={() => bot.checkNow.mutate(product.tcin)}
            >
              {checking ? "Checking…" : "Check now"}
            </button>

            {/*
              This puts a real item in a real cart and then takes it out again.
              It is the only way to prove the cart path works, since a restock
              cannot be scheduled — so it stays, and the label says what it does
              rather than sitting next to "Check now" looking equally harmless.
            */}
            <button
              type="button"
              className={styles.secondary}
              disabled={carting}
              onClick={() => bot.testCart.mutate(product.tcin)}
            >
              {carting ? "Carting…" : "Test the cart"}
              <ScreenReaderOnly>— adds this to your real Target cart, then removes it again</ScreenReaderOnly>
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

          {carting ? (
            <p className={styles.prose}>Driving the browser through the cart — this takes 15–30 seconds.</p>
          ) : null}

          {cartFailed ? (
            <p className={styles.error} role="alert">
              The cart test could not run — the bot is unreachable, or it took longer than two minutes.
              Nothing was left in your cart by this app, but it is worth a look.
            </p>
          ) : null}

          {cartResult ? <CartResult result={cartResult} /> : null}
        </Stack>
      </Card>
    </li>
  );
}

/**
 * What the cart attempt actually did.
 *
 * `detail` is the bot's own sentence rather than a friendly translation of it:
 * "added to cart — Target requires a re-sign-in" says the login expired, and
 * flattening that to "failed" throws away the one fact worth having.
 */
function CartResult({ result }: { result: CartTestResult }) {
  return (
    <Stack gap={2}>
      <p className={result.ok ? styles.ok : styles.error}>
        {result.ok ? "Worked" : "Did not complete"} — {result.detail}
      </p>
      <p className={styles.prose}>
        Cleanup removed {result.removed} {result.removed === 1 ? "item" : "items"} from the cart.
        {result.removed === 0 && result.ok
          ? " Nothing was removed despite it reporting success — check the cart yourself."
          : ""}
      </p>
      {result.screenshot ? (
        <img className={styles.shot} src={result.screenshot} alt="Where the cart attempt stopped" />
      ) : null}
    </Stack>
  );
}

/** See `BotHealth.chipTone` — `Chip` has no error tone, and the word carries it. */
function chipTone(tone: Tone): "default" | "accent" | "warn" {
  if (tone === "good") return "accent";
  if (tone === "neutral") return "default";
  return "warn";
}
