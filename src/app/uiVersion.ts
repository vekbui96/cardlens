/**
 * Which web UI to render: the one that grew, or the one being rebuilt.
 *
 * v2 is a rebuild of the PRESENTATION layer only — screens, shell, styling,
 * navigation — sharing the same models, storage, sync and recogniser. See
 * `docs/v2/PLAN.md` for what is in each column and why.
 *
 * It is a runtime toggle rather than a branch because the two have to be
 * comparable on the same data, on the same device, without a rebuild: "is the
 * new binder screen actually better" is a question you answer by flipping
 * between them with your own collection loaded, not by remembering.
 */

export type UiVersion = "v1" | "v2";

/** Where the opt-in is remembered. Versioned like every other key here. */
export const UI_VERSION_KEY = "cardlens:v1:ui-version";

function isVersion(value: unknown): value is UiVersion {
  return value === "v1" || value === "v2";
}

/** `?v=2` — the override, and how e2e and a shared link pin a version. */
export function uiVersionFromLocation(search?: string): UiVersion | null {
  const raw = new URLSearchParams(search ?? window.location.search).get("v");
  if (raw === null) return null;
  // `?v=2` is what a person types; `?v=v2` is what a person pastes back.
  const normalised = raw.startsWith("v") ? raw : `v${raw}`;
  return isVersion(normalised) ? normalised : null;
}

/**
 * Resolve the version, URL first and storage second.
 *
 * DEFAULTS TO v1, and stays that way until v2 reaches the parity bar in
 * `docs/v2/PLAN.md` §6. A rebuild that becomes the default before it is finished
 * is a rebuild that ships its own half-built state to whoever opens the app.
 *
 * Storage is read defensively: a private window, cleared site data, or a
 * browser refusing storage all throw, and the answer then is simply v1.
 */
export function resolveUiVersion(override?: UiVersion | null, stored?: string | null): UiVersion {
  if (override) return override;
  return isVersion(stored) ? stored : "v1";
}

export function readStoredUiVersion(): string | null {
  try {
    return window.localStorage.getItem(UI_VERSION_KEY);
  } catch {
    return null;
  }
}

/**
 * Remember a choice. Storing v1 REMOVES the key rather than writing "v1" —
 * absent and default are the same state, and this codebase does not keep two
 * ways to spell one value (see `quantity`, `forTrade`, `cover`).
 */
export function storeUiVersion(version: UiVersion): void {
  try {
    if (version === "v1") window.localStorage.removeItem(UI_VERSION_KEY);
    else window.localStorage.setItem(UI_VERSION_KEY, version);
  } catch {
    // Refused storage is survivable: the switch then lasts for this page only.
  }
}

/**
 * The version this device should render, for a given layout mode.
 *
 * The GLASSES never get v2, whatever the flag says. v2 is a web rebuild; the
 * 600x600 additive display is a different product with opposite requirements
 * (see CLAUDE.md), and `preview` deliberately mimics it. Gating here rather than
 * inside the shell means no v2 code can ever mount on the device.
 */
export function activeUiVersion(mode: "glasses" | "web" | "preview"): UiVersion {
  if (mode !== "web") return "v1";
  return resolveUiVersion(uiVersionFromLocation(), readStoredUiVersion());
}
