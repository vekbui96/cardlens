import { useState, type FormEvent } from "react";
import { Panel, Stack } from "../../primitives/index.ts";
import styles from "./target.module.css";

/**
 * The watchlist token, entered per device.
 *
 * **Not the collection sync token, and it must never be read from or written to
 * that token's storage key.** These routes reach a browser that can put real
 * items in a real Target cart, whereas the collection token is deliberately
 * spread across every device that syncs cards. One device managing the
 * watchlist is the entire point of them being separate, and the panel says so
 * where someone is about to paste — the moment the mistake gets made.
 *
 * `useTargetBot` reads and writes `target-settings`; `getSyncSettings` owns
 * `sync-settings`. Nothing in this directory touches either key directly.
 */
export function ConnectPanel({ onConnect }: { onConnect: (token: string) => void }) {
  const [value, setValue] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed) onConnect(trimmed);
  };

  return (
    <Stack gap={5}>
      <header>
        <h1 className={styles.title}>Target restock</h1>
        <p className={styles.summary}>This device is not connected to the bot yet.</p>
      </header>

      <Panel title="Connect this device" headingLevel={2} tone="raised">
        <form onSubmit={submit}>
          <Stack gap={3}>
            <p className={styles.prose}>
              The watchlist lives on the bot, not in this browser, so nothing here is lost by not being
              connected — this device simply has no way to read it yet.
            </p>

            <div className={styles.field}>
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
            </div>

            <button type="submit" className={styles.submit} disabled={!value.trim()}>
              Connect
            </button>

            <p className={styles.prose}>
              This is <span className={styles.proseStrong}>TARGET_TOKEN</span>, which is a different token
              from the collection sync token and is not interchangeable with it. The collection token is on
              every device you sync cards from; this one can add things to a Target cart, so it belongs on
              one.
            </p>
          </Stack>
        </form>
      </Panel>
    </Stack>
  );
}
