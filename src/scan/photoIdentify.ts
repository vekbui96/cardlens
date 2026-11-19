import type { CardIndex, IndexedCard, ScanResult } from "./cardIndex.ts";
import type { CardOutline, IdentifyReply } from "../models/identify.ts";
import { toPixels, type CropBox } from "./cropBox.ts";
import { apiBaseUrl } from "../services/sync/http.ts";

/**
 * "What card is in this photo?" — the upload path beside the camera scanner.
 *
 * The camera path hashes a tightly framed 245x342 crop, which only means
 * anything when the card fills the on-screen guide. A photo from a phone's
 * gallery (or its camera, through the file picker) is framed however it was
 * taken, so it goes to a different engine: Mault on SERVER-PC, behind
 * `POST /api/cards/identify`, which straightens the card itself. The server
 * translates Mault's TCGdex ids into the pokemontcg.io ids CardLens files,
 * drops what the card index lacks, and owns the accept gate.
 *
 * **There is no on-device fallback for a photo**, unlike a capture: the phash
 * index cannot match an unframed picture. When the server cannot answer, the
 * row says so, offers a retry, and stays fixable through Pick by set.
 */

/** Long edge of what is uploaded. Plenty for an embedding, ~300KB not ~5MB through the tunnel. */
const UPLOAD_EDGE = 1600;
/** Long edge of the preview shown to a human reading the collector number. */
const PREVIEW_EDGE = 720;
const THUMB_WIDTH = 82;

/** Phone upload over a relayed tunnel, then ~100-300ms of embedding. */
export const IDENTIFY_TIMEOUT_MS = 30_000;

/** The token is missing or refused — stays broken until Settings, so no retry. */
export class PhotoAuthError extends Error {
  constructor(message = "the server rejected this device's token") {
    super(message);
    this.name = "PhotoAuthError";
  }
}

/** Offline, unconfigured, throttled or unreachable — worth a retry. */
export class PhotoUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoUnavailableError";
  }
}

export interface PreparedPhoto {
  /** What is sent to the server. */
  upload: Blob;
  /** Data URL for the review row's thumbnail. */
  thumb: string;
  /** Data URL large enough to read the collector number from. */
  preview: string;
  /** Width / height, as decoded (EXIF orientation applied). */
  aspect: number;
}

function drawScaled(source: CanvasImageSource, w: number, h: number, edge: number): HTMLCanvasElement {
  const scale = Math.min(1, edge / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("the photo could not be encoded"))),
      "image/jpeg",
      quality,
    ),
  );
}

async function decode(
  file: Blob,
): Promise<{ source: CanvasImageSource; w: number; h: number; done: () => void }> {
  // createImageBitmap honours EXIF orientation, so a portrait phone photo is
  // not uploaded sideways.
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close() };
    } catch {
      // Fall through to <img>, which decodes a few formats bitmaps refuse.
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("that file is not a picture this browser can open");
  }
  return { source: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
}

/**
 * Decode once and produce the three sizes a row needs. Re-encoded as JPEG,
 * which also turns whatever the phone produced (HEIC on some iPhones) into
 * something the server and Mault can certainly read.
 */
export async function preparePhoto(file: Blob): Promise<PreparedPhoto> {
  const { source, w, h, done } = await decode(file);
  try {
    const upload = await toBlob(drawScaled(source, w, h, UPLOAD_EDGE), 0.9);
    const preview = drawScaled(source, w, h, PREVIEW_EDGE).toDataURL("image/jpeg", 0.88);
    const thumb = drawScaled(source, w, h, (THUMB_WIDTH * Math.max(w, h)) / Math.min(w, h)).toDataURL(
      "image/jpeg",
      0.6,
    );
    return { upload, thumb, preview, aspect: w / h };
  } finally {
    done();
  }
}

/** A photo's answer, in the shape the review row already draws. */
export interface PhotoScanResult extends ScanResult {
  reason: string;
  /**
   * Whether the server found the card's outline in the photo. `false` is the
   * cue to offer a hand crop; null when the server cannot say (older Mault).
   */
  outlineFound: boolean | null;
  /** The outline it straightened, as fractions of the photo, when it used one. */
  outline: CardOutline | null;
}

/**
 * Cut `box` (fractions of the photo) out of `photo` at full resolution, as a
 * JPEG to send for identification again. The server's own straightening still
 * runs on it, so a loose box around a tilted card is fine.
 */
export async function cropPhoto(photo: Blob, box: CropBox): Promise<Blob> {
  const { source, w, h, done } = await decode(photo);
  try {
    const { sx, sy, sw, sh } = toPixels(box, w, h);
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    canvas.getContext("2d")?.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
    return await toBlob(canvas, 0.92);
  } finally {
    done();
  }
}

/** Ask the server what card is in this photo. */
export async function identifyPhoto(
  photo: Blob,
  token: string,
  index: CardIndex | null = null,
): Promise<PhotoScanResult> {
  if (!token) throw new PhotoAuthError("connect this device in Settings to identify photos");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IDENTIFY_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/cards/identify`, {
      method: "POST",
      body: photo,
      signal: controller.signal,
      headers: { authorization: `Bearer ${token}`, "content-type": photo.type || "image/jpeg" },
    });
  } catch (err) {
    throw new PhotoUnavailableError(
      err instanceof Error && err.name === "AbortError"
        ? "the server took too long"
        : "the server is unreachable",
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) throw new PhotoAuthError();
  if (!res.ok) {
    let error = "";
    try {
      error = String(((await res.json()) as { error?: unknown })?.error ?? "");
    } catch {
      // Not JSON: an older server with no such route, or a proxy page.
    }
    throw new PhotoUnavailableError(
      error.startsWith("mault_")
        ? "photo recognition is offline on the server"
        : error === "collection_sync_disabled"
          ? "the server has no token configured"
          : res.status === 429
            ? "the server is rate-limiting this device"
            : res.status === 404
              ? "the server does not support photos yet"
              : `the server answered HTTP ${res.status}`,
    );
  }

  let reply: IdentifyReply;
  try {
    reply = (await res.json()) as IdentifyReply;
  } catch {
    throw new PhotoUnavailableError("the server sent something that was not a result");
  }
  if (!Array.isArray(reply?.candidates)) {
    throw new PhotoUnavailableError("the server sent a result with no candidates");
  }
  return toPhotoScanResult(reply, index);
}

/** Map the shared reply onto the review row's shape. Pure. */
export function toPhotoScanResult(reply: IdentifyReply, index: CardIndex | null = null): PhotoScanResult {
  const byId = new Map<string, IndexedCard>();
  for (const card of index?.cards ?? []) byId.set(card.id, card);

  const candidates = reply.candidates.map((c) => ({
    card: byId.get(c.cardId) ?? {
      id: c.cardId,
      name: c.name,
      number: c.collectorNumber,
      setId: c.setId,
      setName: c.setName,
      rarity: null,
    },
    distance: c.distance,
    confidence: c.confidence,
  }));

  return {
    match: candidates.length > 0 ? { ordinal: 0, distance: candidates[0].distance } : null,
    runnerUp: candidates.length > 1 ? { ordinal: 1, distance: candidates[1].distance } : null,
    // The server owns the gate, exactly as it does for /api/recognize.
    confident: reply.status === "MATCHED" && candidates.length > 0,
    candidates,
    reason: reply.reason ?? "",
    outlineFound: typeof reply.outlineFound === "boolean" ? reply.outlineFound : null,
    outline: reply.outline ?? null,
  };
}
