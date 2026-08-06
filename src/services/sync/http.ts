/**
 * The request plumbing both sync clients share.
 *
 * Extracted rather than copied: the timeout, the bearer header and the two
 * statuses that mean "this stays broken until someone acts" are the same
 * decisions for binders as for the collection, and a second copy is a second
 * thing to forget when one of them changes. The hung-fetch bug this timeout
 * exists for was found once already; it should not be findable twice.
 */

/** Long enough for a big first push over a relayed tunnel, short enough to fail. */
export const REQUEST_TIMEOUT_MS = 20_000;

export class SyncDisabledError extends Error {
  constructor() {
    super("sync is not configured on the server");
    this.name = "SyncDisabledError";
  }
}

export class SyncAuthError extends Error {
  constructor() {
    super("the sync token was rejected");
    this.name = "SyncAuthError";
  }
}

/** Payload rejected as too large — permanent for this payload, unlike being offline. */
export class SyncTooLargeError extends Error {
  constructor() {
    super("the server refused the payload as too large");
    this.name = "SyncTooLargeError";
  }
}

/**
 * The route does not exist on this server.
 *
 * Distinguished because the frontend and the server deploy SEPARATELY — Pages
 * and a Windows service on a home machine — so a browser running new code
 * against an older server is a normal transient state, not a fault. Treating it
 * as a generic failure would wedge sync on "offline" and retry every thirty
 * seconds against a route that will never answer until somebody deploys.
 */
export class SyncNotFoundError extends Error {
  constructor() {
    super("this server does not have that endpoint");
    this.name = "SyncNotFoundError";
  }
}

export function apiBaseUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return (env?.VITE_COMPANION_API_BASE_URL ?? "/api").replace(/\/$/, "");
}

/**
 * An authenticated JSON request that always settles.
 *
 * A hung fetch never resolves, which previously left a caller's in-flight guard
 * stuck true forever — sync sat on "syncing" and silently swallowed every later
 * attempt, including a manual one.
 */
export async function syncRequest<T>(
  base: string,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(init.headers ?? {}),
        authorization: `Bearer ${token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }

  // These are worth distinguishing from a generic failure: they are permanent
  // until the user acts, so retrying silently forever would hide a wrong token
  // behind an "offline" label.
  if (res.status === 401) throw new SyncAuthError();
  if (res.status === 503) throw new SyncDisabledError();
  if (res.status === 413) throw new SyncTooLargeError();
  if (res.status === 404) throw new SyncNotFoundError();
  if (!res.ok) throw new Error(`sync failed (HTTP ${res.status})`);

  return (await res.json()) as T;
}
