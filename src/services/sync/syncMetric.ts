import type { MetricEvent } from "../../models/metricsEvents.ts";
import { SyncAuthError, SyncDisabledError, SyncNotFoundError, SyncTooLargeError } from "./http.ts";

/**
 * How a failed sync run is counted.
 *
 * Mirrors the status line's own split — `bad-token` and `disabled` stay broken
 * until someone acts — and separates the two things it deliberately folds
 * together as "offline": the server never answered, and the server answered
 * with an error. The status line does not need that difference; a sync failure
 * rate does.
 */
export function syncFailureMetric(err: unknown): MetricEvent {
  if (err instanceof SyncAuthError) return "sync.bad_token";
  if (err instanceof SyncDisabledError) return "sync.disabled";
  if (err instanceof SyncTooLargeError) return "sync.fail.too_large";
  if (err instanceof SyncNotFoundError) return "sync.fail.http";
  // fetch rejects with a TypeError when nothing answered, and the request
  // timeout aborts; syncRequest's own errors are plain Errors carrying a status.
  // A DOMException is not an Error in every engine, so the abort is read by name.
  const name = typeof err === "object" && err !== null ? (err as { name?: unknown }).name : undefined;
  if (err instanceof TypeError || name === "AbortError") return "sync.fail.offline";
  return "sync.fail.http";
}
