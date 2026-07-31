import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { SessionStore } from "./sessionStore.ts";

const PORT = Number(process.env.PORT ?? 8787);
const SESSION_TTL_MS = Number(process.env.COMPANION_SESSION_TTL_SECONDS ?? 300) * 1000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
const POKEMONTCG_BASE = "https://api.pokemontcg.io/v2";
const POKEMONTCG_API_KEY = process.env.POKEMONTCG_API_KEY ?? "";
const MAX_INPUT_LENGTH = 100;

/** Minimal in-memory fixed-window rate limiter (per IP + route bucket). */
function rateLimiter(maxPerWindow: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${req.ip}:${req.baseUrl}${req.path.split("/")[1] ?? ""}`;
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now > entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
    } else if (entry.count >= maxPerWindow) {
      res.status(429).json({ error: "rate_limited" });
      return;
    } else {
      entry.count += 1;
    }
    next();
  };
}

function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  // This is a JSON API — lock the CSP right down.
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  next();
}

export function createApp(store: SessionStore = new SessionStore(SESSION_TTL_MS)) {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json({ limit: "8kb" }));
  app.use(securityHeaders);
  // The relay carries only user-typed card names, uses unguessable short-lived
  // codes, and is rate-limited — so by default we reflect any Origin. This is
  // important for the Meta glasses WebView, whose fetch may present an unexpected
  // or `null` Origin that a strict allowlist would reject. Set CORS_STRICT=true to
  // restrict to ALLOWED_ORIGINS.
  const strict = process.env.CORS_STRICT === "true" && !ALLOWED_ORIGINS.includes("*");
  app.use(
    cors({
      origin(origin, cb) {
        if (!strict || !origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
        return cb(null, false);
      },
      methods: ["GET", "POST", "OPTIONS"],
    }),
  );

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, sessions: store.size });
  });

  // --- Companion session relay ---------------------------------------------
  const companionLimiter = rateLimiter(60, 60_000);

  app.post("/api/session", companionLimiter, (_req, res) => {
    const session = store.create();
    res.json({ sessionId: session.sessionId, code: session.code, expiresAt: session.expiresAt });
  });

  app.get("/api/session/:code", companionLimiter, (req, res) => {
    const code = String(req.params.code ?? "").slice(0, 12);
    res.json(store.status(code));
  });

  app.post("/api/session/:code/submit", companionLimiter, (req, res) => {
    const code = String(req.params.code ?? "").slice(0, 12);
    const raw = (req.body as { value?: unknown })?.value;
    if (typeof raw !== "string") {
      res.status(400).json({ error: "invalid_value" });
      return;
    }
    const value = raw.trim().slice(0, MAX_INPUT_LENGTH);
    if (!value) {
      res.status(400).json({ error: "empty_value" });
      return;
    }
    const result = store.submit(code, value);
    if (!result.ok) {
      res.status(result.status === "expired" ? 410 : 404).json({ error: result.status });
      return;
    }
    res.json({ ok: true });
  });

  // --- Optional catalog proxy (adds server-side API key + short cache) ------
  const proxyLimiter = rateLimiter(120, 60_000);
  const proxyCache = new Map<string, { at: number; body: unknown }>();
  const PROXY_TTL_MS = 60_000;
  /**
   * Entries are now kept past their TTL to serve as a stale fallback, so the
   * map no longer self-limits by freshness. Bound it: this runs as a service
   * that stays up for weeks, and every distinct query would otherwise be
   * retained forever. Oldest insertion is evicted first.
   */
  const PROXY_CACHE_MAX = 500;

  function cacheResponse(path: string, body: unknown): void {
    if (proxyCache.size >= PROXY_CACHE_MAX && !proxyCache.has(path)) {
      const oldest = proxyCache.keys().next();
      if (!oldest.done) proxyCache.delete(oldest.value);
    }
    proxyCache.set(path, { at: Date.now(), body });
  }

  /**
   * Fetch once. Separated so the retry policy above it stays readable.
   * Returns null for any 5xx or network failure — both are "try again".
   */
  async function fetchUpstream(path: string): Promise<{ ok: true; body: unknown } | { ok: false; status: number }> {
    const headers: Record<string, string> = {};
    if (POKEMONTCG_API_KEY) headers["X-Api-Key"] = POKEMONTCG_API_KEY;
    try {
      const upstream = await fetch(`${POKEMONTCG_BASE}${path}`, { headers });
      if (!upstream.ok) return { ok: false, status: upstream.status };
      return { ok: true, body: (await upstream.json()) as unknown };
    } catch {
      return { ok: false, status: 0 }; // network error / DNS / timeout
    }
  }

  /**
   * pokemontcg.io returns a 500 on roughly a quarter of requests, at random —
   * measured, not assumed: 3 of 12 identical queries failed straight from the
   * command line with no proxy involved. Passing that through means a user sees
   * an error every fourth search, so this layer absorbs it two ways.
   *
   * 1. Retry 5xx and network errors. At a 25% failure rate, two retries take
   *    the miss rate to ~1.6%.
   * 2. Fall back to stale cache. A minute-old card list beats an error screen,
   *    and card data barely changes.
   *
   * 4xx is NOT retried: a bad query fails identically however many times it is
   * sent, and retrying just delays the error.
   */
  async function proxy(path: string, res: Response): Promise<void> {
    const cached = proxyCache.get(path);
    if (cached && Date.now() - cached.at < PROXY_TTL_MS) {
      res.json(cached.body);
      return;
    }

    const backoffMs = [150, 400];
    let last: { ok: false; status: number } = { ok: false, status: 0 };

    for (let attempt = 0; attempt <= backoffMs.length; attempt++) {
      const result = await fetchUpstream(path);
      if (result.ok) {
        cacheResponse(path, result.body);
        res.json(result.body);
        return;
      }
      last = result;
      // Client errors are deterministic — stop immediately.
      if (result.status >= 400 && result.status < 500) break;
      const delay = backoffMs[attempt];
      if (delay !== undefined) await new Promise((r) => setTimeout(r, delay));
    }

    if (cached) {
      const ageSec = Math.round((Date.now() - cached.at) / 1000);
      console.warn(`[cardlens] upstream ${last.status || "unreachable"} for ${path} — serving ${ageSec}s stale`);
      res.setHeader("X-Cardlens-Stale", String(ageSec));
      res.json(cached.body);
      return;
    }

    console.warn(`[cardlens] upstream ${last.status || "unreachable"} for ${path} — no cache to fall back on`);
    if (last.status === 0) {
      res.status(502).json({ error: "upstream_unreachable" });
    } else {
      res.status(last.status).json({ error: "upstream_error", status: last.status });
    }
  }

  app.get("/api/catalog/cards", proxyLimiter, async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (typeof req.query.pageSize === "string") params.set("pageSize", req.query.pageSize);
    if (typeof req.query.select === "string") params.set("select", req.query.select);
    await proxy(`/cards?${params.toString()}`, res);
  });

  app.get("/api/catalog/cards/:id", proxyLimiter, async (req, res) => {
    const id = String(req.params.id ?? "").replace(/[^a-zA-Z0-9-]/g, "");
    await proxy(`/cards/${encodeURIComponent(id)}`, res);
  });

  return app;
}

// Boot when run directly (tsx). Skipped under Vitest, which only imports createApp.
if (!process.env.VITEST) {
  const store = new SessionStore(SESSION_TTL_MS);
  setInterval(() => store.sweep(), 60_000).unref();
  createApp(store).listen(PORT, () => {
    console.log(`[cardlens] companion+proxy server on http://localhost:${PORT}`);
  });
}
