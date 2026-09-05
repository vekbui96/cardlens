import { Chip, Panel, Row, Stack } from "../../primitives/index.ts";
import type { BotRuntime } from "../../../models/target.ts";
import { formatUpdated } from "../../../utils/format.ts";
import { lastSweepLabel, sweepHealth, type Tone } from "./targetState.ts";
import styles from "./target.module.css";

/**
 * The bot's own health, next to the products.
 *
 * This panel is the reason the screen is trustworthy at all: a watchlist where
 * nothing has restocked and a watchlist that stopped checking look exactly the
 * same from the product rows alone. So the state is stated in words, and every
 * figure that could make "nothing has restocked" a lie — when it last swept, how
 * often it sweeps, how many sweeps it has done — is shown beside it.
 */
export function BotHealth({
  runtime,
  onSetPaused,
  pausing,
}: {
  runtime: BotRuntime;
  onSetPaused: (paused: boolean) => void;
  pausing: boolean;
}) {
  const health = sweepHealth(runtime);

  return (
    <Panel
      title="Bot health"
      headingLevel={2}
      tone="raised"
      aside={
        <button
          type="button"
          className={styles.secondary}
          disabled={pausing}
          onClick={() => onSetPaused(!runtime.paused)}
        >
          {runtime.paused ? "Resume checking" : "Pause checking"}
        </button>
      }
    >
      <Stack gap={3}>
        <Row gap={2} wrap>
          <Chip tone={chipTone(health.tone)}>{health.label}</Chip>
        </Row>

        {health.detail ? <p className={styles.prose}>{health.detail}</p> : null}

        <dl className={styles.stats}>
          {/*
            Everything in this list counts against a real clock or a running
            total, so all of it is marked volatile: a visual baseline taken
            today would otherwise fail tomorrow for saying a true thing.
          */}
          <Stat label="Last sweep" value={lastSweepLabel(runtime)} volatile />
          <Stat
            label="Sweeps every"
            value={runtime.checkIntervalSeconds > 0 ? `${runtime.checkIntervalSeconds}s` : "Not stated"}
          />
          <Stat label="Sweeps done" value={runtime.checksCompleted.toLocaleString()} volatile />
          <Stat
            label="Up since"
            value={runtime.startedAt ? formatUpdated(runtime.startedAt) : "Unknown"}
            volatile
          />
          <Stat label="Store" value={runtime.storeId || "Not stated"} />
        </dl>
      </Stack>
    </Panel>
  );
}

/**
 * `Chip` has four tones and none of them is an error tone.
 *
 * Rather than fork the primitive for one screen, "bad" and "warn" share the
 * amber chip and the LABEL carries the difference — "Blocked by Target" and
 * "Paused" are not going to be confused for one another by anybody reading the
 * word, and colour was never allowed to be the carrier here anyway.
 */
function chipTone(tone: Tone): "default" | "accent" | "warn" {
  if (tone === "good") return "accent";
  if (tone === "neutral") return "default";
  return "warn";
}

function Stat({ label, value, volatile: isVolatile }: { label: string; value: string; volatile?: boolean }) {
  return (
    <div className={styles.stat}>
      <dt className={styles.statLabel}>{label}</dt>
      <dd className={styles.statValue} {...(isVolatile ? { "data-snapshot": "volatile" } : {})}>
        {value}
      </dd>
    </div>
  );
}
