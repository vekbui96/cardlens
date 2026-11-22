import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/**
 * Recovery from a lazy chunk that a deploy has deleted.
 *
 * Every Pages deploy renames EVERY chunk: the entry's hash changes, and every
 * chunk that imports from it changes with it (measured: the build before and
 * after #144 shared not one `.js` filename). The deploy also replaces the
 * whole site, so the old names 404. A tab opened before the deploy still holds
 * the old entry, and the first screen it has not visited yet asks for a chunk
 * that is gone — on 2026-11-22 that was v2 Binders on an iPhone, three minutes
 * after a merge: "This screen broke — Importing a module script failed."
 *
 * The fix is a full reload, which fetches the new entry. It is done
 * automatically ONCE, and only when it can work:
 *
 * - **Only on the render path.** `lazyWithReload` and `preloadableScreen`'s
 *   lazy call this; prefetches do not. A hover-prefetch that reloads the page
 *   under someone's half-typed search would be worse than the bug.
 * - **Not offline.** The same "failed to fetch" is what a dropped connection
 *   looks like, and with no service worker a reload while offline replaces the
 *   app with the browser's offline page. So the document is fetched first, and
 *   a failure there means no reload.
 * - **Not twice in a row.** A sessionStorage timestamp blocks a second
 *   automatic reload within `AUTO_RELOAD_COOLDOWN_MS`, so a chunk that is
 *   genuinely broken lands on the error boundary instead of looping. If that
 *   storage cannot be read or written, there is no guard, so there is no
 *   automatic reload either.
 *
 * Fetching the document with `cache: "reload"` also matters: Pages serves
 * `index.html` with `max-age=600`, and a reload that came back with the cached
 * old entry would ask for the same deleted chunk again. The fetch refreshes the
 * HTTP cache entry the reload then reads. There is no service worker to defeat
 * it (see `index.html`).
 */

export const AUTO_RELOAD_KEY = "cardlens:stale-chunk-reload";
export const AUTO_RELOAD_COOLDOWN_MS = 60_000;
const PROBE_TIMEOUT_MS = 8_000;

/**
 * What each engine says when a dynamic import's file cannot be fetched.
 * Vite's own CSS-preload failure is matched too; its JS failures are the
 * engine's message, and anything it reports is also tagged by the listener.
 */
const CHUNK_ERROR_PATTERNS: readonly RegExp[] = [
  /Importing a module script failed/i, // Safari
  /Failed to fetch dynamically imported module/i, // Chrome, Edge
  /error loading dynamically imported module/i, // Firefox
  /Unable to preload CSS for/i, // Vite's preload helper
];

const vitePreloadErrors = new WeakSet<object>();

/** True for an error that means "this chunk could not be loaded". */
export function isChunkLoadError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (vitePreloadErrors.has(error)) return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Seams for tests: jsdom's `location.reload` cannot be replaced, and the
 * storage-throws cases need a storage that throws.
 */
export const staleChunkEnv = {
  reload: (): void => window.location.reload(),
  now: (): number => Date.now(),
  storage: (): Storage => window.sessionStorage,
  online: (): boolean => typeof navigator === "undefined" || navigator.onLine !== false,
  /** The current document, past the HTTP cache. Resolves false when it cannot be fetched. */
  refreshDocument: async (): Promise<boolean> => {
    if (typeof fetch !== "function") return true;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = setTimeout(() => controller?.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(window.location.href.split("#")[0] ?? window.location.href, {
        cache: "reload",
        credentials: "same-origin",
        ...(controller ? { signal: controller.signal } : {}),
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  },
};

/**
 * Tag what Vite's preload helper reports, so `isChunkLoadError` recognises it
 * whatever its message. It does NOT `preventDefault`: the error carries on to
 * the import that asked for it, and only a render-path import reloads. Called
 * once, from `main.tsx`.
 */
export function installStaleChunkRecovery(target: Window = window): void {
  target.addEventListener("vite:preloadError", (event) => {
    const payload = (event as Event & { payload?: unknown }).payload;
    if (typeof payload === "object" && payload !== null) vitePreloadErrors.add(payload);
  });
}

/** May an automatic reload happen now? False when it cannot be guarded. */
function cooldownAllows(now: number): boolean {
  try {
    const last = Number(staleChunkEnv.storage().getItem(AUTO_RELOAD_KEY));
    // Absolute, so a clock that went backwards also counts as "just reloaded".
    return !(last > 0 && Math.abs(now - last) < AUTO_RELOAD_COOLDOWN_MS);
  } catch {
    return false;
  }
}

function recordAutoReload(now: number): boolean {
  try {
    staleChunkEnv.storage().setItem(AUTO_RELOAD_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

async function attemptAutoReload(): Promise<boolean> {
  if (!staleChunkEnv.online()) return false;
  if (!cooldownAllows(staleChunkEnv.now())) return false;
  if (!(await staleChunkEnv.refreshDocument())) return false;
  // Re-read the clock: the fetch can take seconds.
  if (!recordAutoReload(staleChunkEnv.now())) return false;
  staleChunkEnv.reload();
  return true;
}

/** Shared, so two screens failing in one render make one attempt, not two. */
let attempt: Promise<boolean> | null = null;

/**
 * The rejection handler for a render-path dynamic import.
 *
 * A chunk error starts (or joins) the one automatic reload and then never
 * settles, so the Suspense fallback stays up until the page goes away rather
 * than flashing the error screen first. When the reload is not allowed — the
 * cooldown, offline, no storage — it rethrows, and the error boundary shows it
 * with a Try again that reloads. Any other error is rethrown untouched.
 */
export async function recoverFromChunkError(error: unknown): Promise<never> {
  if (!isChunkLoadError(error)) throw error;
  attempt ??= attemptAutoReload();
  if (await attempt) return new Promise<never>(() => {});
  attempt = null;
  throw error;
}

/**
 * The boundary's Try again for a chunk error. Retrying the import cannot work —
 * the browser keeps a failed module fetch — so it reloads, after refreshing
 * the cached document for the same reason the automatic path does.
 */
export function reloadForUpdate(): void {
  void staleChunkEnv.refreshDocument().finally(() => staleChunkEnv.reload());
}

/** `React.lazy`, recovering from a chunk a deploy deleted. Same signature as `lazy`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors React's own `lazy` constraint
export function lazyWithReload<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() => load().catch(recoverFromChunkError));
}

/** Test-only: forget an attempt that "reloaded" a page jsdom never left. */
export function resetStaleChunkRecovery(): void {
  attempt = null;
}
