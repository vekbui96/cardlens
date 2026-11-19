/**
 * Photo identification through Mault, a self-hosted card-recognition stack on
 * this machine (`D:\services\mault`, docker compose, loopback :3001).
 *
 * The scanner's own recogniser (server/recognition.ts) hashes a 245x342 crop
 * taken inside an on-screen guide; it cannot take an arbitrary photo from a
 * phone's gallery, because the hash only means anything over a tightly framed
 * card. Mault straightens the card itself and matches an image embedding, so a
 * free-form photo works. That is the whole reason this second engine exists.
 *
 * Same proxy rules as the recogniser:
 * - **Loopback only.** Mault is never exposed; this service fronts it behind
 *   COLLECTION_TOKEN, like `/api/recognize`.
 * - **Never throws.** Down, unconfigured, wedged and refusing are ordinary
 *   states reported as 503 `mault_unavailable` / `mault_timeout`, so the UI can
 *   say "offline, retry" instead of the route having to catch.
 * - **Credentials stay here.** Mault's local-auth issues session tokens that
 *   expire, so this signs in with the trial account, caches the token in memory
 *   and signs in again once on a 401. Nothing about the token reaches a log or
 *   a response.
 *
 * Answers are translated from TCGdex ids to CardLens's pokemontcg.io ids and
 * validated against the card index (server/tcgdexIds.ts), then judged by a
 * deliberately conservative gate (`judgeMault`, below).
 *
 * **Which Mault route.** Upstream `POST /cards` embeds the whole upload, so it
 * only matches when the picture IS the card; a casually framed phone photo got
 * 2/34 top-1 on the photo-like eval set. This box's Mault carries a local patch
 * (`D:\services\mault\patches-local\`) adding `POST /cards/photo`, which finds
 * the card's corners, straightens it, and then runs the same match: 27/34. The
 * client asks that route first and falls back to `/cards` for good on a 404, so
 * an un-patched Mault (after an upstream update) still answers, just worse.
 */
import type { CardOutline, IdentifyCandidate, IdentifyReply, OutlinePoint } from "../src/models/identify.ts";
import type { CardIndexLookup, IndexCard } from "./cardIndexLookup.ts";
import { toPokemonTcgId } from "./tcgdexIds.ts";

export interface MaultConfig {
  url: string;
  email: string;
  password: string;
  orgId: string;
  collectionGuid: string;
}

/** The "CardLens trial" Pokémon collection on this box's Mault. */
const DEFAULT_COLLECTION_GUID = "08419cb7-b5ee-4aab-982a-f4e6f8e14e6c";

export function maultConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MaultConfig {
  return {
    url: (env.MAULT_URL ?? "http://127.0.0.1:3001").replace(/\/$/, ""),
    email: env.MAULT_EMAIL ?? "",
    password: env.MAULT_PASSWORD ?? "",
    orgId: env.MAULT_ORG_ID ?? "",
    collectionGuid: env.MAULT_COLLECTION_GUID ?? DEFAULT_COLLECTION_GUID,
  };
}

/**
 * Embedding + straightening is ~100-300ms warm; the first call after a Mault
 * restart loads a model and has taken a few seconds. Past this it is wedged.
 */
const TIMEOUT_MS = 20_000;

/** Kept equal to the three the review row offers for a camera capture. */
const CANDIDATES = 3;

/**
 * The accept gate. **Conservative on purpose: a false accept files the wrong
 * card silently; a refusal only costs one tap in review.**
 *
 * Measured over 34 rendered card images on 2026-11-18 (Mault's `confidence` is
 * a per-candidate score, NOT a softmax: same-art reprints both score ~0.999):
 * - Every correct answer the gate accepts scored >= 0.952 with no runner-up
 *   within 0.13 distance. Correct answers that scored lower (0.47-0.91: base1-58,
 *   ex3-86, pop3-11, gym2-132, xy12-93) are left as "Which one?", which is the
 *   price of the three misses below never being auto-accepted.
 * - The three misses were bw11-52 → bw4-51 (0.672), mcd12-6 → bw2-32 (0.724,
 *   distance 0.167) and xyp-XY39 → xy5-108 (0.579, distance 0.346, no runner-up
 *   at all — the card was not in Mault's collection). All fall under 0.95.
 * - Same-art reprints (g1-56/xy8-117, sv2-169/sv4pt5-75, swsh1-169/swsh35-56)
 *   come back as TWO candidates at ~0.999 within ~0.003 distance, so a high
 *   top score alone is not enough: the runner-up must be both clearly further
 *   away (MIN_GAP) and clearly less sure (RUNNER_UP_MAX_CONFIDENCE).
 * - MAX_DISTANCE bounds a confident score on a poor match; the worst accepted
 *   render sat at 0.173. Real phone photos will sit further out than renders —
 *   they will fall to review, never to a wrong accept.
 * These are renders, not photographs; re-measure with real photos before
 * loosening anything.
 */
export const MIN_CONFIDENCE = 0.95;
export const MAX_DISTANCE = 0.25;
export const MIN_GAP = 0.05;
export const RUNNER_UP_MAX_CONFIDENCE = 0.5;

/** One entry of Mault's `POST /cards` answer. Only the first carries `card`. */
export interface MaultMatch {
  cardId?: string;
  id?: string;
  distance?: number;
  confidence?: number;
  card?: { name?: string; collectorNumber?: string };
}

/** The extras `/cards/photo` adds to `/cards`' answer. */
export interface MaultPhotoExtras {
  detected?: unknown;
  corners?: unknown;
  orientation?: unknown;
}

export interface MaultReply {
  status: number;
  body: IdentifyReply | { error: string };
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

const pct = (c: number) => `${Math.round(c * 100)}%`;

/**
 * The two catalogues spell suffixes differently ("Venusaur EX" / "Venusaur-EX",
 * "Charizard GX" / "Charizard-GX") and TCGdex drops "LV.X" ("Empoleon" /
 * "Empoleon LV.X"). Compared without punctuation, one may extend the other.
 * This only guards the id translation; it is not what identifies the card.
 */
function sameName(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const [x, y] = [norm(a), norm(b)];
  return x.length > 0 && y.length > 0 && (x.startsWith(y) || y.startsWith(x));
}

/**
 * Turn Mault's raw matches into the shared reply: translate ids, drop what
 * CardLens cannot file, and decide whether the top one is safe to pre-choose.
 * Pure, so the gate is testable without a network.
 */
export function judgeMault(
  matches: MaultMatch[],
  cards: Map<string, IndexCard>,
  processingTimeMs = 0,
): IdentifyReply {
  const known = (id: string) => cards.has(id);
  const candidates: IdentifyCandidate[] = [];
  const seen = new Set<string>();
  let topResolved = false;

  matches.forEach((m, i) => {
    const raw = m.cardId ?? m.id;
    if (typeof raw !== "string") return;
    const id = toPokemonTcgId(raw, known);
    const card = id ? cards.get(id) : undefined;
    if (!card || seen.has(card.id)) return;
    // Mault names its top match. If that name disagrees with ours the
    // translation landed on a different card than Mault meant — keep it as a
    // candidate for a human, but never let it be the confident answer.
    const nameAgrees = !m.card?.name || sameName(m.card.name, card.name);
    if (i === 0 && nameAgrees) topResolved = true;
    seen.add(card.id);
    candidates.push({
      cardId: card.id,
      name: card.name,
      setId: card.setId,
      setName: card.setName,
      collectorNumber: card.number,
      distance: num(m.distance, 1),
      confidence: typeof m.confidence === "number" && Number.isFinite(m.confidence) ? m.confidence : null,
    });
  });

  const offered = candidates.slice(0, CANDIDATES);
  const base = { candidates: offered, recogniser: "mault" as const, processingTimeMs };

  if (offered.length === 0) {
    return {
      ...base,
      status: "UNKNOWN",
      reason:
        matches.length > 0 ? "Mault named cards CardLens does not have" : "Mault found no card in the photo",
    };
  }

  const top = matches[0];
  const topConfidence = num(top.confidence, 0);
  const topDistance = num(top.distance, 1);
  // The runner-up is read from Mault's RAW list, before translation, so a
  // near-identical card CardLens happens not to index still counts as a rival.
  const runner = matches[1];
  const gap = runner ? num(runner.distance, 1) - topDistance : Infinity;
  const runnerConfidence = runner ? num(runner.confidence, 0) : 0;

  // Mault's unsure answer names its nearest cards with no score at all. Saying
  // "only 0% sure" about that reads as a measurement; it is not one.
  if (typeof top.confidence !== "number") {
    return { ...base, status: "AMBIGUOUS", reason: "Mault isn't sure — pick the right card" };
  }

  const why: string[] = [];
  if (!topResolved) why.push("its best match is not in CardLens");
  if (topConfidence < MIN_CONFIDENCE) why.push(`only ${pct(topConfidence)} sure`);
  if (topDistance > MAX_DISTANCE) why.push("a distant match");
  if (runner && (gap < MIN_GAP || runnerConfidence >= RUNNER_UP_MAX_CONFIDENCE)) {
    why.push("another card looks almost the same — check the number");
  }

  if (why.length === 0) {
    return {
      ...base,
      status: "MATCHED",
      reason: `Mault ${pct(topConfidence)} sure${runner ? `, next ${gap.toFixed(2)} away` : ""}`,
    };
  }
  return { ...base, status: "AMBIGUOUS", reason: `Mault: ${why.join("; ")}` };
}

/**
 * The adapter. One per process: it holds the cached session token.
 */
export class MaultClient {
  private token: string | null = null;

  constructor(
    private readonly index: CardIndexLookup,
    private readonly config: MaultConfig = maultConfigFromEnv(),
  ) {}

  get configured(): boolean {
    return Boolean(this.config.email && this.config.password && this.config.orgId);
  }

  /** Sign in for a fresh session token. Null on any failure; never logs the secret. */
  private async signIn(): Promise<string | null> {
    try {
      const res = await fetch(`${this.config.url}/local-auth/sign-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: this.config.email, password: this.config.password }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        console.warn(`[cardlens] mault sign-in refused (HTTP ${res.status})`);
        return null;
      }
      const body = (await res.json()) as { data?: { token?: unknown } };
      return typeof body?.data?.token === "string" ? body.data.token : null;
    } catch {
      return null;
    }
  }

  /**
   * `/cards/photo` until this Mault has said it does not have it (404), then
   * `/cards` for the life of the process. A restart re-checks, which is when a
   * re-patched Mault would be picked up anyway.
   */
  private photoRoute = true;

  private async post(image: Buffer, contentType: string, token: string): Promise<Response> {
    if (this.photoRoute) {
      const res = await this.send("/cards/photo", image, contentType, token);
      if (res.status !== 404) return res;
      this.photoRoute = false;
      console.warn("[cardlens] mault has no /cards/photo (un-patched?); using /cards");
    }
    return this.send("/cards", image, contentType, token);
  }

  private send(route: string, image: Buffer, contentType: string, token: string): Promise<Response> {
    const form = new FormData();
    form.append("image", new Blob([new Uint8Array(image)], { type: contentType }), "photo");
    form.append("collectionGuid", this.config.collectionGuid);
    return fetch(`${this.config.url}${route}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "X-Org-Id": this.config.orgId },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  /** Identify one photo. Never throws. */
  async identify(image: Buffer, contentType: string): Promise<MaultReply> {
    if (!this.configured) return { status: 503, body: { error: "mault_unavailable" } };
    const started = Date.now();
    try {
      this.token ??= await this.signIn();
      if (!this.token) return { status: 503, body: { error: "mault_unavailable" } };

      let res = await this.post(image, contentType, this.token);
      if (res.status === 401) {
        // Session tokens expire. One fresh sign-in, then give up: a second 401
        // means the credentials themselves are wrong, and looping would hammer
        // a sign-in endpoint.
        this.token = await this.signIn();
        if (!this.token) return { status: 503, body: { error: "mault_unavailable" } };
        res = await this.post(image, contentType, this.token);
      }

      // Mault answers 500 "Failed to vectorize image" for bytes it cannot
      // decode — the photo's fault, not the engine's, and retrying won't help.
      if (res.status === 400 || res.status === 422 || (res.status === 500 && (await isUndecodable(res)))) {
        return { status: 200, body: judgeMault([], new Map(), Date.now() - started) };
      }
      if (!res.ok) return { status: 503, body: { error: "mault_unavailable" } };

      let parsed: { data?: unknown; diagnostics?: { candidates?: unknown } } & MaultPhotoExtras;
      try {
        parsed = (await res.json()) as typeof parsed;
      } catch {
        return { status: 502, body: { error: "mault_bad_response" } };
      }
      const matches = maultMatchesOf(parsed);
      if (!matches) return { status: 502, body: { error: "mault_bad_response" } };

      const cards = await this.index.load();
      return {
        status: 200,
        body: { ...judgeMault(matches, cards, Date.now() - started), ...outlineOf(parsed) },
      };
    } catch (err) {
      const timedOut = err instanceof Error && err.name === "TimeoutError";
      if (!timedOut)
        console.warn("[cardlens] mault identify failed:", err instanceof Error ? err.message : err);
      return { status: 503, body: { error: timedOut ? "mault_timeout" : "mault_unavailable" } };
    }
  }
}

/**
 * Mault's match list. When it is not sure — a real phone photo, almost always —
 * it answers `success: true` with `data: null` and puts its nearest cards in
 * `diagnostics.candidates` (cardId + distance, no confidence). Those are still
 * worth showing a human, and a missing confidence reads as 0 so the gate can
 * never pre-choose one. Null only when neither list is there: a reply we do not
 * understand. (Found 2026-11-19: every phone upload came back as "offline".)
 */
export function maultMatchesOf(parsed: {
  data?: unknown;
  diagnostics?: { candidates?: unknown };
}): MaultMatch[] | null {
  if (Array.isArray(parsed?.data)) return parsed.data as MaultMatch[];
  if (parsed?.data === null || parsed?.data === undefined) {
    const fallback = parsed?.diagnostics?.candidates;
    if (Array.isArray(fallback)) return fallback as MaultMatch[];
    if (parsed?.data === null) return [];
  }
  return null;
}

function point(v: unknown): OutlinePoint | null {
  const p = v as { x?: unknown; y?: unknown } | null;
  const ok = (n: unknown): n is number =>
    typeof n === "number" && Number.isFinite(n) && n >= -0.05 && n <= 1.05;
  return p && ok(p.x) && ok(p.y)
    ? { x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) }
    : null;
}

/**
 * What `/cards/photo` says about the card's outline, validated. Nothing at all
 * from plain `/cards` (no `detected` field), so the client can tell "found no
 * outline" from "cannot say". The outline is only passed on when the
 * straightened card is what matched: when the whole photo won, the photo
 * already was the card and the detector had outlined something inside it.
 */
export function outlineOf(parsed: MaultPhotoExtras): Pick<IdentifyReply, "outlineFound" | "outline"> {
  if (typeof parsed?.detected !== "boolean") return {};
  const c = parsed.corners as Record<string, unknown> | null | undefined;
  const corners = c
    ? {
        topLeft: point(c.topLeft),
        topRight: point(c.topRight),
        bottomRight: point(c.bottomRight),
        bottomLeft: point(c.bottomLeft),
      }
    : null;
  const complete =
    corners && corners.topLeft && corners.topRight && corners.bottomRight && corners.bottomLeft
      ? (corners as CardOutline)
      : null;
  return {
    outlineFound: parsed.detected,
    outline: parsed.detected && parsed.orientation !== "whole" ? complete : null,
  };
}

async function isUndecodable(res: Response): Promise<boolean> {
  try {
    const body = (await res.clone().json()) as { message?: unknown };
    return typeof body?.message === "string" && /vectori[sz]e image|unsupported image/i.test(body.message);
  } catch {
    return false;
  }
}
