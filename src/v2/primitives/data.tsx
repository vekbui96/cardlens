import type { CSSProperties, ReactNode } from "react";
import styles from "./primitives.module.css";
import { cx } from "./layout.tsx";
import { formatUsd, UNAVAILABLE, UNPRICED } from "../../utils/format.ts";

type Vars = CSSProperties & Record<`--${string}`, string>;

/* --- Meter ---------------------------------------------------------------- */

interface MeterProps {
  /** How far along, 0–1. Values outside that range are clamped, not trusted. */
  value: number;
  /** What the bar is measuring. Read by assistive technology; often shown too. */
  label: string;
  /** The right-hand figure — "42 / 198", "68%". Shown verbatim. */
  detail?: ReactNode;
  /** Hide the text row, for a tile that already says all of this in words. */
  labelHidden?: boolean;
}

/**
 * A progress bar with its number beside it.
 *
 * Complete turns the bar gold, and `detail` should say so in words as well.
 * Green-against-gold is exactly the pair deuteranopia collapses, so the colour
 * is a reward for noticing, never the thing being communicated.
 */
export function Meter({ value, label, detail, labelHidden = false }: MeterProps) {
  const ratio = clamp01(value);
  const complete = ratio >= 1;
  const pct = Math.round(ratio * 100);
  const vars: Vars = { "--fill": `${pct}%` };

  return (
    <div className={styles.meter}>
      <div
        className={styles.meterTrack}
        role="progressbar"
        aria-label={label}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cx(styles.meterFill, complete && styles.meterFillComplete)}
          style={vars}
          data-started={ratio > 0 ? "true" : "false"}
        />
      </div>
      {labelHidden ? null : (
        <div className={styles.meterLabel}>
          <span>{label}</span>
          {detail !== undefined ? <span className={styles.meterValue}>{detail}</span> : null}
        </div>
      )}
    </div>
  );
}

/**
 * NaN is the case that matters. A completion ratio is a division, and an empty
 * set makes it 0/0 — which as a bar width renders as no bar at all and reads
 * as "you have none of this" rather than "there is nothing to have".
 */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/* --- Chip ----------------------------------------------------------------- */

interface ChipProps {
  children: ReactNode;
  tone?: "default" | "accent" | "warn" | "gold";
  /** Makes it a real button, with a real target size. */
  onPress?: () => void;
  pressed?: boolean;
  label?: string;
  /** Inert: aria-disabled, and a press does nothing (the button stays focusable). */
  disabled?: boolean;
}

export function Chip({ children, tone = "default", onPress, pressed, label, disabled }: ChipProps) {
  const cls = cx(
    styles.chip,
    tone === "accent" && styles.chipAccent,
    tone === "warn" && styles.chipWarn,
    tone === "gold" && styles.chipGold,
  );

  if (onPress) {
    return (
      <button
        type="button"
        className={cx(cls, styles.chipButton)}
        onClick={disabled ? undefined : onPress}
        {...(disabled ? { "aria-disabled": true, "data-chip-disabled": "" } : {})}
        {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
        {...(label ? { "aria-label": label } : {})}
      >
        {children}
      </button>
    );
  }

  return <span className={cls}>{children}</span>;
}

/* --- Money ---------------------------------------------------------------- */

/**
 * The one word for a card with no price; pass it as `absentLabel` on card and
 * set prices. Defined with the other shared formatters in utils/format.ts.
 */
export { UNPRICED };

interface MoneyProps {
  /**
   * The amount. `undefined` means "we do not have a price"; it does not mean
   * zero, and rendering it as `$0.00` is the bug this component exists to
   * prevent — a free card and an unpriced card are not the same card.
   */
  value: number | undefined | null;
  /** True while the price is still in flight. Shows "Pricing…", never a zero. */
  loading?: boolean;
  /** Replaces "Unavailable" where the screen has a better word for it. */
  absentLabel?: string;
}

export function Money({ value, loading = false, absentLabel = UNAVAILABLE }: MoneyProps) {
  if (loading) {
    return <span className={cx(styles.money, styles.moneyAbsent)}>Pricing…</span>;
  }
  const text = formatUsd(value);
  if (text === UNAVAILABLE) {
    return <span className={cx(styles.money, styles.moneyAbsent)}>{absentLabel}</span>;
  }
  return <span className={styles.money}>{text}</span>;
}
