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
  if (width < 720 || height < 680) return "web";
  return "preview";
}

/** True when the device has a real pointer and scrollbar — phone or browser. */
export function isWebMode(mode: LayoutMode): boolean {
  return mode === "web";
}

export function layoutOverrideFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("ui");
}
