/**
 * Which shell the app renders in.
 *
 *   glasses — the raw fixed 600x600 surface the Meta device actually shows
 *   web     — a responsive shell for a phone or a browser window
 *   preview — the desktop bezel that mimics the glasses, for development
 *
 * The screens themselves are identical in all three: same focus ring, same
 * keyboard handling, same components. Only the shell differs, so there is no
 * second UI to keep in step — which is the mistake this deliberately avoids.
 */
export type LayoutMode = "glasses" | "web" | "preview";

/** The glasses viewport is a 600x600 square; allow slack for chrome. */
function looksLikeGlasses(width: number, height: number): boolean {
  const squareish = Math.abs(width - height) <= 80;
  return squareish && width <= 700 && height <= 700;
}

export function resolveLayoutMode(width: number, height: number, override?: string | null): LayoutMode {
  if (override === "glasses" || override === "web" || override === "preview") return override;
  // Order matters: the glasses are small AND square, while a phone is small and
  // tall. Checking size alone would put the phone in the fixed 600x600 shell,
  // which overflows a narrow screen — the bug this fixes.
  if (looksLikeGlasses(width, height)) return "glasses";
  /**
   * Everything else is a browser — phone, tablet, laptop or desktop — and gets
   * the real app.
   *
   * A large window used to default to `preview`, the 600x600 bezel mock. That
   * made sense while the desktop was only somewhere to develop the glasses UI,
   * but web is a first-class target now, and it meant anyone opening the site on
   * a laptop was shown a picture of a pair of glasses instead of the app.
   *
   * The preview is still there, as the development tool it always was: `?ui=preview`.
   */
  return "web";
}

/**
 * Below this on either side a viewport is not a screen anyone is reading: the
 * glasses are 600x600 and the smallest phone is over 300px wide.
 */
const MIN_REAL_VIEWPORT_PX = 200;

/**
 * The mode after a resize, keeping the current one through a degenerate size.
 *
 * Chromium's full-page capture briefly resizes the window to 1x1. That is
 * small AND square, so `resolveLayoutMode` called it the glasses, and the app
 * swapped the whole web tree for the glasses one and back within a frame. The
 * remount cancelled every in-flight query, so a rate-limited price request
 * mid-retry lost its 429 and re-asked from scratch. Measured 2026-11-24 in the
 * CI visual image: the v2 Home rate-limited snapshot flipped between two states
 * for exactly this reason. No real display is 1px, so a size like that changes
 * nothing.
 */
export function nextLayoutMode(
  current: LayoutMode,
  width: number,
  height: number,
  override?: string | null,
): LayoutMode {
  if (width < MIN_REAL_VIEWPORT_PX || height < MIN_REAL_VIEWPORT_PX) return current;
  return resolveLayoutMode(width, height, override);
}

/** True when the device has a real pointer and scrollbar — phone or browser. */
export function isWebMode(mode: LayoutMode): boolean {
  return mode === "web";
}

export function layoutOverrideFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("ui");
}
