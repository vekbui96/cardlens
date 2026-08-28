import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import compression from "compression";
import { SessionStore } from "./sessionStore.ts";
import { CollectionStore, MAX_ROWS_PER_REQUEST, parseRow } from "./collectionStore.ts";
import { PrintingsStore } from "./printingsStore.ts";
import { CatalogPriceStore } from "./catalogPrices.ts";
import { SealedStore } from "./sealedStore.ts";
import { callBot, validTcin } from "./targetBot.ts";
import { ShareStore } from "./shareStore.ts";
import { BinderStore, MAX_BINDERS_PER_REQUEST, parseBinder } from "./binderStore.ts";
import { isLiveBinder } from "../src/storage/binders.ts";
import { BinderImageStore, ImageTooLargeError, MAX_IMAGE_BYTES } from "./binderImages.ts";
import { callRecogniser, recogniserHealth, MAX_IMAGE_BYTES as MAX_RECOGNITION_BYTES } from "./recognition.ts";

const PORT = Number(process.env.PORT ?? 8787);
const SESSION_TTL_MS = Number(process.env.COMPANION_SESSION_TTL_SECONDS ?? 300) * 1000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
const POKEMONTCG_BASE = "https://api.pokemontcg.io/v2";
const POKEMONTCG_API_KEY = process.env.POKEMONTCG_API_KEY ?? "";
const MAX_INPUT_LENGTH = 100;
/**
 * Sets one price request may name. A collection spanning more than this is
 * priced in several requests rather than being refused — but an unbounded list
 * would let one URL trigger arbitrarily many upstream fetches.
 */
const MAX_PRICE_SETS = 60;
const COLLECTION_TOKEN = process.env.COLLECTION_TOKEN ?? "";
/**
 * Separate from COLLECTION_TOKEN on purpose. The collection token is entered on
 * every syncing device and only moves card rows; this one can drive a browser
 * that adds items to a real Target cart. Sharing one token would give every
 * device the larger power, and rotating either would break both.
 */
const TARGET_TOKEN = process.env.TARGET_TOKEN ?? "";
// Forward slashes deliberately: Node accepts them on Windows, and a backslash
// path in a TS literal silently collapses (\s \d \c are just s, d, c).
const COLLECTION_FILE = process.env.COLLECTION_FILE ?? "D:/services/data/collection.json";
const PRINTINGS_DIR = process.env.PRINTINGS_DIR ?? "D:/services/data/printings";
const SEALED_DIR = process.env.SEALED_DIR ?? "D:/services/data/sealed";
const CATALOG_PRICES_DIR = process.env.CATALOG_PRICES_DIR ?? "D:/services/data/catalog-prices";
/**
 * The card recogniser, on loopback. Tailscale Funnel only permits 443, 8443 and
 * 10000, and two are already spent — so this service fronts it rather than the
 * recogniser being exposed itself. See server/recognition.ts.
 */
const RECOGNITION_URL = (process.env.RECOGNITION_URL ?? "http://127.0.0.1:8200").replace(/\/$/, "");
const SHARES_FILE = process.env.SHARES_FILE ?? "D:/services/data/shares.json";
const BINDERS_FILE = process.env.BINDERS_FILE ?? "D:/services/data/binders.json";
const BINDER_IMAGES_DIR = process.env.BINDER_IMAGES_DIR ?? "D:/services/data/binder-images";

/** Upstream failed with nothing cached to fall back on. */
class UpstreamError extends Error {
  constructor(readonly status: number) {
    super(`upstream failed (${status || "unreachable"})`);
    this.name = "UpstreamError";
  }
}

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

export function createApp(
  store: SessionStore = new SessionStore(SESSION_TTL_MS),
  collection: CollectionStore = new CollectionStore(COLLECTION_FILE),
  printingsStore: PrintingsStore = new PrintingsStore(PRINTINGS_DIR),
  sealedStore: SealedStore = new SealedStore(SEALED_DIR),
  shares: ShareStore = new ShareStore(SHARES_FILE),
  binders: BinderStore = new BinderStore(BINDERS_FILE),
  binderImages: BinderImageStore = new BinderImageStore(BINDER_IMAGES_DIR),
) {
  const app = express();
  app.set("trust proxy", true);
  // 8kb suits the companion relay, but a full collection sync is a few thousand
  // rows; the route-level row cap is the real bound.
  app.use(express.json({ limit: "4mb" }));
  /**
   * Gzip. Everything this server returns is JSON with heavily repeated keys, and
   * none of it was compressed — measured against the live funnel, the home
   * dashboard's price index is 113KB on the wire and took 8.7s to arrive from a
   * warm cache that had answered in 148ms for a single set. The bytes were the
   * whole cost.
   *
   * Before the routes, so it covers all of them: printings, set-information and
   * a full collection sync are the same shape of repetitive JSON.
   */
  app.use(compression());
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
      // PATCH/DELETE exist for the Target watchlist. Widening this list only
      // changes what a BROWSER may attempt cross-origin; the shared token is
      // still the gate, and no other route implements either verb.
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, sessions: store.size });
  });

  // --- Companion session relay ---------------------------------------------
  const companionLimiter = rateLimiter(60, 60_000);
  // Declared here rather than beside the proxy routes: limiters are resolved
  // when routes are REGISTERED, so a const defined further down would be in its
  // temporal dead zone and crash the server on start.
  const printingsLimiter = rateLimiter(60, 60_000);

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

  // --- Collection sync -------------------------------------------------------
  /**
   * These endpoints are reachable from the public internet via Tailscale Funnel,
   * so they are the one part of this service that can be written to by a
   * stranger. A shared bearer token gates them.
   *
   * With no token configured the routes return 503 rather than running open —
   * failing closed, because the failure mode of the alternative is silent and
   * permanent.
   */
  function requireToken(req: Request, res: Response, next: NextFunction): void {
    if (!COLLECTION_TOKEN) {
      res.status(503).json({ error: "collection_sync_disabled" });
      return;
    }
    const header = req.get("authorization") ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (presented !== COLLECTION_TOKEN) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  }

  const collectionLimiter = rateLimiter(120, 60_000);

  app.get("/api/collection", collectionLimiter, requireToken, (req, res) => {
    const raw = req.query.since;
    const since = typeof raw === "string" ? Number(raw) : 0;
    const rows = Number.isFinite(since) && since > 0 ? collection.since(since) : collection.all();
    res.json({ rows, at: Date.now() });
  });

  app.post("/api/collection/merge", collectionLimiter, requireToken, (req, res) => {
    const body = req.body as { rows?: unknown };
    if (!Array.isArray(body?.rows)) {
      res.status(400).json({ error: "invalid_rows" });
      return;
    }
    if (body.rows.length > MAX_ROWS_PER_REQUEST) {
      res.status(413).json({ error: "too_many_rows", max: MAX_ROWS_PER_REQUEST });
      return;
    }
    // Invalid rows are dropped, not fatal: one malformed row should not reject
    // a sync carrying hundreds of good ones.
    const incoming = body.rows.flatMap((r) => parseRow(r) ?? []);
    const dropped = body.rows.length - incoming.length;
    if (dropped > 0) console.warn(`[cardlens] collection merge dropped ${dropped} invalid row(s)`);
    const rows = collection.merge(incoming);
    res.json({ rows, at: Date.now(), dropped });
  });

  // --- Binder sync -----------------------------------------------------------
  /**
   * Binders converge per binder, last write wins — NOT per pocket. See
   * storage/binders.ts for why; the short version is that a binder is one
   * arrangement rather than a set of independent facts, and merging pocket by
   * pocket would produce a page neither device laid out.
   *
   * Same token as collection sync, on purpose: a binder is a view of the
   * collection, it is entered on the same devices, and a second token would be
   * a second thing to type in for no extra safety. The Target token is separate
   * because it can spend money; this cannot.
   */
  const binderLimiter = rateLimiter(120, 60_000);
  /**
   * Far looser than the sync routes, because one binder page is a dozen image
   * GETs at once and scrolling through a binder is hundreds. Reads are cheap
   * static bytes; it is the writes that need the tight bucket.
   */
  const binderImageLimiter = rateLimiter(600, 60_000);

  app.get("/api/binders", binderLimiter, requireToken, (req, res) => {
    const raw = req.query.since;
    const since = typeof raw === "string" ? Number(raw) : 0;
    const rows = Number.isFinite(since) && since > 0 ? binders.since(since) : binders.all();
    res.json({ binders: rows, at: Date.now() });
  });

  app.post("/api/binders/merge", binderLimiter, requireToken, (req, res) => {
    const body = req.body as { binders?: unknown };
    if (!Array.isArray(body?.binders)) {
      res.status(400).json({ error: "invalid_binders" });
      return;
    }
    if (body.binders.length > MAX_BINDERS_PER_REQUEST) {
      res.status(413).json({ error: "too_many_binders", max: MAX_BINDERS_PER_REQUEST });
      return;
    }
    // Invalid binders are dropped rather than fatal, matching collection sync:
    // one malformed binder must not reject a push carrying good ones. The count
    // is returned so the client can say something instead of losing it in
    // silence.
    const incoming = body.binders.flatMap((b) => parseBinder(b) ?? []);
    const dropped = body.binders.length - incoming.length;
    if (dropped > 0) console.warn(`[cardlens] binder merge dropped ${dropped} invalid binder(s)`);
    const merged = binders.merge(incoming);

    // Orphan art, well after the fact. Sweeping here rather than on a timer
    // keeps it tied to the moment the reference set actually changed; the age
    // floor inside sweep() is what makes it safe to run this often.
    const removed = binderImages.sweep(binders.referencedImages());
    if (removed.length > 0) console.info(`[cardlens] swept ${removed.length} unreferenced binder image(s)`);

    res.json({ binders: merged, at: Date.now(), dropped });
  });

  /**
   * Custom binder art.
   *
   * Upload needs the token; reading does NOT — same rule as a live share, and
   * for the same reason. The id is 16 random bytes and is the credential, which
   * is what lets a shared binder render for somebody who has no token.
   */
  app.post("/api/binders/images", binderLimiter, requireToken, (req, res) => {
    const body = req.body as { dataUrl?: unknown };
    try {
      const id = binderImages.save(body?.dataUrl);
      if (!id) {
        res.status(400).json({ error: "invalid_image" });
        return;
      }
      res.json({ id });
    } catch (err) {
      if (err instanceof ImageTooLargeError) {
        res.status(413).json({ error: "image_too_large", max: MAX_IMAGE_BYTES });
        return;
      }
      throw err;
    }
  });

  app.get("/api/binders/images/:id", binderImageLimiter, (req, res) => {
    const image = binderImages.read(String(req.params.id ?? ""));
    // 404 for malformed, unknown and traversal alike — the route says nothing
    // about which, the same way an unknown share id does not.
    if (!image) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    // The bytes at an id never change, so this can be cached hard. It has to
    // be: a binder page is a dozen of these at once, on a tethered connection.
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Content-Type", image.contentType);
    res.send(image.body);
  });

  // --- Card recognition ------------------------------------------------------
  /**
   * "What card is this?" — proxied to a loopback Python service.
   *
   * Behind COLLECTION_TOKEN rather than a token of its own. The blast radius is
   * the same as collection sync's: it reads an image and answers with a card
   * id. It cannot spend money, which is the whole reason TARGET_TOKEN is
   * separate, and a third token to type into every device buys nothing.
   *
   * The CardLens scanner DOES use this, as of 2026-08-10 — server first, with
   * the on-device index as the fallback when this route does not answer. See
   * server/recognition.ts.
   */
  /**
   * 300/min, not the 60 every other route gets.
   *
   * A scanning session is the only caller that arrives in a sustained burst:
   * auto-capture locks out for 700ms, so one device tops out near 85 captures a
   * minute and 60 would throttle an ordinary stack of cards. The far side is a
   * loopback process answering in ~110ms, so 300 is roughly half a core, and
   * the ceiling still exists to bound an abusive client rather than a busy one.
   */
  const recognitionLimiter = rateLimiter(300, 60_000);

  /**
   * The recogniser's own test page, re-pointed at this server's proxy.
   *
   * Unauthenticated on purpose: it is markup and script with no secrets in it,
   * and the POST behind it still demands the token. Gating the page as well
   * would mean a second way to present credentials for no extra protection.
   *
   * This exists so a phone can photograph a card anywhere and see the verdict —
   * which is the only way the real accuracy numbers ever get measured. The
   * recogniser itself stays on loopback.
   */
  app.get("/api/recognize/bench", recognitionLimiter, async (_req, res) => {
    const reply = await fetch(`${RECOGNITION_URL}/`).catch(() => null);
    if (!reply?.ok) {
      res.status(503).type("text/plain").send("The recognition service is not running.");
      return;
    }
    const page = await reply.text();
    // The service-wide CSP is `default-src 'none'`, which is right for a JSON
    // API and fatal for a page: it blocks the inline script and style this one
    // is entirely made of, and the blob: URL that previews the capture.
    // Relaxed HERE only, and no further than the page needs — it still cannot
    // reach another origin or be framed.
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
        "img-src 'self' data: blob:; connect-src 'self'; form-action 'none'; frame-ancestors 'none'",
    );
    res
      .type("html")
      .send(
        page.replace(
          "<script>",
          '<script>window.__RECOGNIZE_ENDPOINT__="/api/recognize";' +
            "window.__RECOGNIZE_NEEDS_TOKEN__=true;</script><script>",
        ),
      );
  });

  app.get("/api/recognize/health", recognitionLimiter, requireToken, async (_req, res) => {
    const reply = await recogniserHealth();
    res.status(reply.status).json(reply.body);
  });

  app.post(
    "/api/recognize",
    recognitionLimiter,
    requireToken,
    // Raw, not JSON: the body is multipart/form-data and re-encoding it would
    // rewrite the boundary and the image. `type: () => true` because a browser
    // sets its own boundary parameter and an exact type match would miss it.
    express.raw({ type: () => true, limit: MAX_RECOGNITION_BYTES }),
    async (req, res) => {
      const contentType = req.get("content-type") ?? "";
      if (!contentType.startsWith("multipart/form-data")) {
        res.status(400).json({ error: "expected_multipart" });
        return;
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({ error: "empty_body" });
        return;
      }
      const reply = await callRecogniser(req.body, contentType);
      res.status(reply.status).json(reply.body);
    },
  );

  // --- Target stock bot ------------------------------------------------------
  /**
   * Read and drive the restock watchlist. Same shared token as collection sync,
   * because it is the same device already holding it — a second token would be
   * a second thing to type into every device for no extra safety.
   *
   * The limit is tighter than collection sync: every call here reaches a real
   * browser on the far side, and a check can take tens of seconds.
   */
  const targetLimiter = rateLimiter(60, 60_000);

  /** Same fail-closed rule as collection sync, against its own token. */
  function requireTargetToken(req: Request, res: Response, next: NextFunction): void {
    if (!TARGET_TOKEN) {
      res.status(503).json({ error: "target_bot_disabled" });
      return;
    }
    const header = req.get("authorization") ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (presented !== TARGET_TOKEN) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  }

  async function relay(res: Response, method: string, path: string, body?: unknown) {
    const reply = await callBot(method, path, body);
    res.status(reply.status).json(reply.body);
  }

  app.get("/api/target/state", targetLimiter, requireTargetToken, async (_req, res) => {
    await relay(res, "GET", "/api/target/state");
  });

  app.post("/api/target/watchlist", targetLimiter, requireTargetToken, async (req, res) => {
    const body = req.body as { target?: unknown; name?: unknown };
    const target = typeof body?.target === "string" ? body.target.trim() : "";
    if (!target) {
      res.status(400).json({ error: "target_required" });
      return;
    }
    const name = typeof body?.name === "string" ? body.name.trim().slice(0, 200) : "";
    await relay(res, "POST", "/api/target/watchlist", {
      target: target.slice(0, 500),
      ...(name ? { name } : {}),
    });
  });

  app.patch("/api/target/watchlist/:tcin", targetLimiter, requireTargetToken, async (req, res) => {
    const { tcin } = req.params;
    if (!validTcin(tcin)) {
      res.status(400).json({ error: "invalid_tcin" });
      return;
    }
    const body = req.body as { enabled?: unknown; autoCart?: unknown };
    const patch: Record<string, boolean> = {};
    if (typeof body?.enabled === "boolean") patch.enabled = body.enabled;
    if (typeof body?.autoCart === "boolean") patch.autoCart = body.autoCart;
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "nothing_to_update" });
      return;
    }
    await relay(res, "PATCH", `/api/target/watchlist/${tcin}`, patch);
  });

  app.delete("/api/target/watchlist/:tcin", targetLimiter, requireTargetToken, async (req, res) => {
    const { tcin } = req.params;
    if (!validTcin(tcin)) {
      res.status(400).json({ error: "invalid_tcin" });
      return;
    }
    await relay(res, "DELETE", `/api/target/watchlist/${tcin}`);
  });

  app.post("/api/target/watchlist/:tcin/check", targetLimiter, requireTargetToken, async (req, res) => {
    const { tcin } = req.params;
    if (!validTcin(tcin)) {
      res.status(400).json({ error: "invalid_tcin" });
      return;
    }
    await relay(res, "POST", `/api/target/watchlist/${tcin}/check`);
  });

  /**
   * Run the cart flow now and undo it. Deliberately its own route rather than
   * a flag on /check: this one puts a real item in a real Target cart before
   * removing it again, which is not something a status refresh should ever do
   * by accident.
   */
  app.post("/api/target/watchlist/:tcin/testcart", targetLimiter, requireTargetToken, async (req, res) => {
    const { tcin } = req.params;
    if (!validTcin(tcin)) {
      res.status(400).json({ error: "invalid_tcin" });
      return;
    }
    await relay(res, "POST", `/api/target/watchlist/${tcin}/testcart`);
  });

  app.post("/api/target/pause", targetLimiter, requireTargetToken, async (req, res) => {
    const body = req.body as { paused?: unknown };
    if (typeof body?.paused !== "boolean") {
      res.status(400).json({ error: "paused_required" });
      return;
    }
    await relay(res, "POST", "/api/target/pause", { paused: body.paused });
  });

  // --- Live shares: a set's progress, or a binder offered for trade ----------
  /**
   * A link that re-reads the data instead of carrying a copy of it.
   *
   * GET is deliberately UNAUTHENTICATED - the whole point is handing the link
   * to somebody who has no token. The id is the credential, so it is 16 random
   * bytes and the route says nothing about whether an unknown id ever existed.
   *
   * Two kinds, one id space and one revocation path. A SET share returns the
   * printings for that one set, and only what is owned: excluded printings are
   * the owner's private bookkeeping about what they intend to chase, not a
   * claim about what they hold. A BINDER share returns that one binder as laid
   * out, which is a trade list — see the handler for why the collection is not
   * consulted for it at all.
   */ const shareLimiter = rateLimiter(120, 60_000);

  app.post("/api/share", shareLimiter, requireToken, (req, res) => {
    const body = req.body as { setId?: unknown; setName?: unknown };
    const setId = typeof body?.setId === "string" ? body.setId.trim().slice(0, 40) : "";
    const setName = typeof body?.setName === "string" ? body.setName.trim().slice(0, 120) : "";
    if (!setId || !setName) {
      res.status(400).json({ error: "set_id_and_name_required" });
      return;
    }
    res.json(shares.createOrReuse(setId, setName));
  });

  app.get("/api/share", shareLimiter, requireToken, (_req, res) => {
    res.json({ shares: shares.live() });
  });

  /**
   * A trade link for one binder.
   *
   * Refuses when this server does not hold the binder yet, rather than minting
   * a link that would 404 for whoever it was sent to. The binder lives on the
   * device until sync pushes it, so "share a binder you have not synced" is the
   * normal first-time case and has to say so — a dead link handed to another
   * collector is the silent failure this codebase keeps being bitten by.
   */
  app.post("/api/share/binder", shareLimiter, requireToken, (req, res) => {
    const body = req.body as { binderId?: unknown };
    const binderId = typeof body?.binderId === "string" ? body.binderId.trim().slice(0, 64) : "";
    if (!binderId) {
      res.status(400).json({ error: "binder_id_required" });
      return;
    }

    const binder = binders.all().find((b) => b.id === binderId && isLiveBinder(b));
    if (!binder) {
      res.status(409).json({ error: "binder_not_synced" });
      return;
    }

    res.json(shares.createOrReuseBinder(binder.id, binder.name));
  });
  app.delete("/api/share/:id", shareLimiter, requireToken, (req, res) => {
    const id = String(req.params.id ?? "").slice(0, 64);
    if (!shares.revoke(id)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ revoked: id });
  });

  app.get("/api/share/:id", shareLimiter, (req, res) => {
    const id = String(req.params.id ?? "").slice(0, 64);
    const share = shares.get(id);
    // 404 for revoked and for never-existed alike: distinguishing them would
    // confirm an id was real to someone probing.
    if (!share) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    /**
     * A traded binder is returned whole, as its owner laid it out.
     *
     * The binder already carries a denormalised name, art and collector number
     * per pocket, so the page paints without the recipient's browser resolving
     * anything — and it prices itself from the PUBLIC printings endpoint, which
     * is why no price is computed here.
     *
     * The collection is not consulted at all. What a trade binder offers is
     * stated by the binder; whether the owner also happens to own a second copy
     * of something is their private bookkeeping, exactly as excluded printings
     * are on a set share.
     */
    if (share.kind === "binder") {
      const binder = binders.all().find((b) => b.id === share.binderId && isLiveBinder(b));
      // Deleting a binder kills its link. Same 404 as an unknown id, because a
      // recipient learning that a binder "used to exist" is the same leak.
      if (!binder) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json({ kind: "binder", binder, at: Date.now() });
      return;
    }

    const owned = collection
      .all()
      .filter((r) => r.setId === share.setId && r.at > (r.deletedAt ?? 0) && !r.excluded)
      .map((r) => ({
        // Rows are keyed by card id; the showcase renders by collector number,
        // which is the suffix. Matching by number is also what makes a shared
        // link resolvable against a catalog that renumbered its ids.
        collectorNumber: r.cardId.slice(r.cardId.lastIndexOf("-") + 1),
        finish: r.finish,
        // When it was marked, so the shared page can draw the same growth
        // curve the owner sees. It reveals acquisition dates for this ONE set
        // and nothing else - the same scope the rest of the payload has.
        at: r.at,
      }));

    // `kind` is additive: clients built before binder shares existed ignore it,
    // and it is what lets a newer one tell the two payloads apart.
    res.json({ kind: "set", setId: share.setId, setName: share.setName, owned, at: Date.now() });
  });

  // --- Printings (TCGdex, cached server-side) --------------------------------
  /**
   * One request per device instead of one per card.
   *
   * Building a set's printings costs 120-295 upstream requests because TCGdex
   * only exposes variants on the individual card endpoint. Doing that on the
   * glasses, over a tethered connection, for every set and every device, is the
   * expensive path this replaces.
   *
   * No auth: this is public catalog data, same as the card proxy.
   */
  app.get("/api/printings/:setId", printingsLimiter, async (req, res) => {
    const setId = String(req.params.setId ?? "").slice(0, 40);
    const setName = typeof req.query.name === "string" ? req.query.name.slice(0, 120) : "";
    if (!setId || !setName) {
      res.status(400).json({ error: "set_id_and_name_required" });
      return;
    }
    try {
      const { value, cached } = await printingsStore.get(setId, setName);
      if (!value) {
        res.status(404).json({ error: "set_not_found_upstream" });
        return;
      }
      // Long client cache: printings for a released set do not change.
      res.setHeader("Cache-Control", "public, max-age=2592000");
      res.setHeader("X-Cardlens-Cache", cached ? "hit" : "miss");
      res.json(value);
    } catch (err) {
      console.warn(`[cardlens] printings failed for ${setId}:`, err);
      res.status(502).json({ error: "printings_unavailable" });
    }
  });

  /**
   * Sealed product prices for a set: pack, ETB, booster box, bundle.
   *
   * Neither card API prices sealed product — both key everything by card, so a
   * booster pack is not a thing either can describe. This reads TCGplayer's own
   * daily dump via tcgcsv, which is the same market price already behind every
   * card figure in the app.
   *
   * Server-side because it costs three upstream requests (groups, products,
   * prices) and the group list alone covers 217 sets; doing that per device,
   * per set, over a tether, is the path this replaces.
   *
   * No auth: public catalog data, same as the printings route.
   */
  app.get("/api/sealed/:setId", printingsLimiter, async (req, res) => {
    const setId = String(req.params.setId ?? "").slice(0, 40);
    const setName = typeof req.query.name === "string" ? req.query.name.slice(0, 120) : "";
    if (!setId || !setName) {
      res.status(400).json({ error: "set_id_and_name_required" });
      return;
    }
    try {
      const { value, cached } = await sealedStore.get(setId, setName);
      if (!value) {
        res.status(404).json({ error: "no_sealed_products" });
        return;
      }
      // Half a day: the source refreshes daily and this is the one figure in
      // the app expected to move day to day.
      res.setHeader("Cache-Control", "public, max-age=43200");
      res.setHeader("X-Cardlens-Cache", cached ? "hit" : "miss");
      res.json(value);
    } catch (err) {
      console.warn(`[cardlens] sealed failed for ${setId}:`, err);
      res.status(502).json({ error: "sealed_unavailable" });
    }
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
  async function fetchUpstream(
    path: string,
  ): Promise<{ ok: true; body: unknown } | { ok: false; status: number }> {
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
  /**
   * Fetch through the cache and retry policy, returning the body.
   *
   * Split out from `proxy` so aggregate endpoints can compose catalog data
   * instead of only streaming it to a client. Throws when there is nothing to
   * serve, including no stale copy.
   */
  async function loadCatalog(path: string): Promise<unknown> {
    const cached = proxyCache.get(path);
    if (cached && Date.now() - cached.at < PROXY_TTL_MS) return cached.body;

    /**
     * Spread across ~4s rather than ~0.5s. Upstream failures arrive in bursts
     * lasting seconds, not as independent coin flips: measured umbreon at
     * 6 successes then 2 consecutive failures 3s apart, while a different query
     * succeeded in between. Tight retries land inside the same burst and all
     * fail together — which is exactly what the logs showed.
     *
     * The cost is only paid on the failing path, and ~4s to return a result
     * beats an instant error screen on a device with no keyboard to retype on.
     */
    const backoffMs = [300, 1_000, 2_500];
    let last: { ok: false; status: number } = { ok: false, status: 0 };

    for (let attempt = 0; attempt <= backoffMs.length; attempt++) {
      const result = await fetchUpstream(path);
      if (result.ok) {
        cacheResponse(path, result.body);
        return result.body;
      }
      last = result;
      // Client errors are deterministic — stop immediately.
      if (result.status >= 400 && result.status < 500) break;
      const delay = backoffMs[attempt];
      if (delay !== undefined) await new Promise((r) => setTimeout(r, delay));
    }

    if (cached) {
      const ageSec = Math.round((Date.now() - cached.at) / 1000);
      console.warn(
        `[cardlens] upstream ${last.status || "unreachable"} for ${path} — serving ${ageSec}s stale`,
      );
      return cached.body;
    }

    console.warn(
      `[cardlens] upstream ${last.status || "unreachable"} for ${path} — no cache to fall back on`,
    );
    throw new UpstreamError(last.status);
  }

  /**
   * Prices for whole sets, cached hard. Constructed here rather than passed in
   * because it must fetch through loadCatalog above — the retry-and-stale
   * policy is worth more to this than to anything else on the server.
   */
  const catalogPrices = new CatalogPriceStore(CATALOG_PRICES_DIR, loadCatalog);

  /** Stream a catalog path straight to a client. */
  async function proxy(path: string, res: Response): Promise<void> {
    try {
      res.json(await loadCatalog(path));
    } catch (err) {
      const status = err instanceof UpstreamError ? err.status : 0;
      if (status === 0) res.status(502).json({ error: "upstream_unreachable" });
      else res.status(status).json({ error: "upstream_error", status });
    }
  }

  /**
   * Everything the set screen needs, in one request.
   *
   * The screen previously made three: rarity-filtered cards for the list,
   * unfiltered cards for the master-set denominator, and printings. All three
   * are held here, so composing them server-side removes two round trips from a
   * device on a tethered connection, and the rarity filter becomes a local
   * operation on data the screen already has.
   */
  app.get("/api/set-information/:setId", proxyLimiter, async (req, res) => {
    const setId = String(req.params.setId ?? "").slice(0, 40);
    const setName = typeof req.query.name === "string" ? req.query.name.slice(0, 120) : "";
    if (!setId) {
      res.status(400).json({ error: "set_id_required" });
      return;
    }

    const cardsPath =
      `/cards?q=${encodeURIComponent(`set.id:${setId}`)}` +
      `&pageSize=250&orderBy=number&select=${encodeURIComponent(
        "id,name,number,rarity,images,tcgplayer,set",
      )}`;

    // Printings are best-effort: a set view without them still works, it just
    // falls back to what pricing implies. Cards are not optional.
    const [cards, printings] = await Promise.all([
      loadCatalog(cardsPath).catch((err: unknown) => {
        throw err;
      }),
      setName
        ? printingsStore.get(setId, setName).then(
            (r) => r.value,
            (err: unknown) => {
              console.warn(`[cardlens] printings unavailable for ${setId}:`, err);
              return null;
            },
          )
        : Promise.resolve(null),
    ]).catch((err: unknown) => {
      const status = err instanceof UpstreamError ? err.status : 0;
      res.status(status === 0 ? 502 : status).json({ error: "set_information_unavailable" });
      return [null, null] as const;
    });

    if (cards === null) return;
    res.setHeader("Cache-Control", "public, max-age=3600");
    // The whole SetPrintings, same as /api/printings returns, not just its
    // byNumber map: the client caches this for 30 days and the record names
    // which TCGdex set it came from. The client accepts either shape, so the two
    // halves can deploy in either order.
    res.json({ setId, cards, printings: printings ?? null });
  });

  /**
   * Market prices for every set a collection holds, in one request.
   *
   * Home prices the whole collection, so it needed the catalog oracle for all
   * of them at once and was asking set by set through the plain proxy: measured
   * live, nineteen calls at 4.5-6.7s each, several never completing. This is one
   * call against a twelve-hour disk cache.
   *
   * **Partial success is the point.** One set that cannot be priced must not
   * cost the other eighteen their numbers, so failures are named in `missing`
   * and everything else is still returned. Home already knows how to say
   * "480 of 973 printings priced"; an empty body would make it say nothing.
   */
  app.get("/api/catalog/prices", proxyLimiter, async (req, res) => {
    const requested = String(req.query.sets ?? "")
      .split(",")
      .map((id) => id.trim().replace(/[^A-Za-z0-9._-]/g, ""))
      .filter(Boolean);
    const setIds = [...new Set(requested)].slice(0, MAX_PRICE_SETS);

    if (setIds.length === 0) {
      res.status(400).json({ error: "sets_required" });
      return;
    }

    const indexes = await Promise.all(
      setIds.map((setId) =>
        catalogPrices.get(setId).then(
          (prices) => ({ setId, prices }),
          (err: unknown) => {
            console.warn(`[cardlens] catalog prices unavailable for ${setId}:`, err);
            return { setId, prices: null };
          },
        ),
      ),
    );

    const prices: Record<string, number> = {};
    const missing: string[] = [];
    for (const { setId, prices: found } of indexes) {
      if (found === null) missing.push(setId);
      else Object.assign(prices, found);
    }

    // Every id is globally unique, so one flat map across sets cannot collide —
    // the same reason the device keeps a single index rather than nesting.
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json({ prices, missing });
  });

  app.get("/api/catalog/sets", proxyLimiter, async (req, res) => {
    const params = new URLSearchParams();
    for (const key of ["orderBy", "pageSize", "select", "q"]) {
      const value = req.query[key];
      if (typeof value === "string") params.set(key, value);
    }
    await proxy(`/sets?${params.toString()}`, res);
  });

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
