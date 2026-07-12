import { ProviderError } from "../integrations/providers.ts";

export interface FetchJsonOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
  method?: string;
  body?: string;
}

const DEFAULT_TIMEOUT_MS = 8000;

/** Merge a caller signal with an internal timeout signal. */
function withTimeout(
  external: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort((external as AbortSignal & { reason?: unknown })?.reason);
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")), timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onAbort);
    },
  };
}

/**
 * fetch + JSON with a request timeout and typed errors. Aborts are re-thrown so
 * TanStack Query can cancel stale requests without surfacing an error state.
 */
export async function fetchJson(url: string, options: FetchJsonOptions = {}): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { signal, cancel } = withTimeout(options.signal, timeoutMs);
  try {
    const res = await fetch(url, {
      signal,
      ...(options.method ? { method: options.method } : {}),
      ...(options.headers ? { headers: options.headers } : {}),
      ...(options.body !== undefined ? { body: options.body } : {}),
    });
    if (res.status === 404) throw new ProviderError("Not found", "not-found");
    if (res.status === 429) throw new ProviderError("Rate limited", "rate-limit");
    if (!res.ok) throw new ProviderError(`Request failed (${res.status})`, "network");
    return (await res.json()) as unknown;
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") throw err; // caller cancelled
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new ProviderError("Request timed out", "timeout", { cause: err });
    }
    throw new ProviderError("Network error", "network", { cause: err });
  } finally {
    cancel();
  }
}
