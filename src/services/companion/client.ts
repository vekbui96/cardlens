import { fetchJson } from "../http.ts";

/**
 * Client for the companion-phone relay (server/). Uses short polling — the
 * simplest reliable option for a stateless-friendly server. Sessions are short-
 * lived and hold only the search text.
 */
export interface CompanionSession {
  sessionId: string;
  code: string;
  expiresAt: number;
}

function baseUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return (env?.VITE_COMPANION_API_BASE_URL ?? "/api").replace(/\/$/, "");
}

export class CompanionClient {
  constructor(private readonly base: string = baseUrl()) {}

  get configured(): boolean {
    return Boolean(this.base);
  }

  /**
   * Create a session (POST). Retries a few times so a sleeping free-tier server
   * (cold start can take ~50s) doesn't fail on the first attempt.
   */
  async createSession(signal?: AbortSignal, attempts = 5): Promise<CompanionSession> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        const json = (await fetchJson(`${this.base}/session`, {
          method: "POST",
          signal,
          timeoutMs: 12000,
        })) as { sessionId?: string; code?: string; expiresAt?: number };
        if (!json.sessionId || !json.code || !json.expiresAt) {
          throw new Error("Invalid session response");
        }
        return { sessionId: json.sessionId, code: json.code, expiresAt: json.expiresAt };
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        lastErr = err;
      }
    }
    throw lastErr ?? new Error("Could not create session");
  }

  /** Submit text from the phone side (POST). Returns true on success. */
  async submit(code: string, value: string, signal?: AbortSignal): Promise<boolean> {
    try {
      const res = await fetch(`${this.base}/session/${encodeURIComponent(code)}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value }),
        ...(signal ? { signal } : {}),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Poll for a submitted value. Resolves with the value, or null on expiry/abort.
   * Uses short polling with a bounded interval.
   */
  async waitForInput(
    code: string,
    opts: { signal?: AbortSignal; intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<string | null> {
    const intervalMs = opts.intervalMs ?? 1500;
    const deadline = Date.now() + (opts.timeoutMs ?? 5 * 60_000);
    while (Date.now() < deadline) {
      if (opts.signal?.aborted) return null;
      try {
        const json = (await fetchJson(`${this.base}/session/${encodeURIComponent(code)}`, {
          signal: opts.signal,
          timeoutMs: 6000,
        })) as { status?: string; value?: string | null };
        if (json.status === "submitted" && typeof json.value === "string") return json.value;
        if (json.status === "expired" || json.status === "not-found") return null;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return null;
        // transient error — keep polling until deadline
      }
      await delay(intervalMs, opts.signal);
    }
    return null;
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });
}
