import type { CSSProperties } from "react";
import styles from "./primitives.module.css";
import { cx } from "./layout.tsx";

interface SkeletonProps {
  /** The height of the thing that will replace it, so nothing jumps on arrival. */
  height?: string;
  className?: string;
}

/**
 * A placeholder block in the shape of content that has not arrived.
 *
 * Decorative: it is hidden from assistive technology, so whoever uses it puts
 * the one "Loading …" sentence (a `ScreenReaderOnly`) and `aria-busy` on the
 * container instead of having every block announced. The shimmer stops under
 * `prefers-reduced-motion`.
 */
export function Skeleton({ height, className }: SkeletonProps) {
  const style: CSSProperties | undefined = height ? { height } : undefined;
  return <div className={cx(styles.skeleton, className)} style={style} aria-hidden="true" data-skeleton="" />;
}
