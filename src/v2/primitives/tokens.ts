/**
 * The token vocabulary, as types.
 *
 * Every primitive takes token NAMES, never lengths — `gap={3}`, not
 * `gap="12px"`. That is what makes "no raw values in v2" checkable rather than
 * merely stated: there is no prop anywhere that accepts a length, so a stream
 * cannot pass one without changing a signature, and TypeScript rejects a step
 * off the scale before the linter ever has to.
 */

/** The 4px spacing scale. `0` is a real step — it means "touching". */
export type Space = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export function space(step: Space): string {
  return `var(--v2-space-${step})`;
}

/** Pocket-derived widths, for the grids that lay cards out. */
export type CardWidth = "pocket" | "pocket-lg";

export function cardWidth(size: CardWidth): string {
  return size === "pocket" ? "var(--v2-pocket)" : "var(--v2-pocket-lg)";
}

export type Align = "start" | "center" | "end" | "baseline" | "stretch";
export type Justify = "start" | "center" | "end" | "space-between";
