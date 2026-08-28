import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

/**
 * Custom binder art, held as files rather than inside the binder.
 *
 * A binder is pushed WHOLE on every edit — moving one card re-sends the object
 * — so an inline data URI would put the same megabytes through the sync
 * endpoint on every drag, and into a localStorage budget this app has already
 * exhausted once. The binder therefore carries a 20-byte id and the bytes live
 * here, uploaded once.
 *
 * Reads are deliberately UNAUTHENTICATED, like a live share: the id is 16
 * random bytes and is the credential. That is what lets a shared binder render
 * for someone who has no token, and lets the glasses fetch art without holding
 * one.
 */

/** Comfortably above a client-resized photo (~100KB) and far below anything abusive. */
export const MAX_IMAGE_BYTES = 2_000_000;

/**
 * Formats a browser can both produce via canvas and display. GIF and SVG are
 * absent on purpose — SVG is a script-execution vector served from the API
 * origin, and this is a still image of a card.
 */
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/**
 * A stored image id: random stem, known extension, nothing else.
 *
 * Defined in models/binderParse.ts and re-exported here, so the validator that
 * ACCEPTS an id and the store that has to SERVE it can never disagree — an id
 * one allows and the other refuses is a permanently broken pocket.
 */
import { IMAGE_ID_PATTERN } from "../src/models/binderParse.ts";

export { IMAGE_ID_PATTERN };
const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/;

export class ImageTooLargeError extends Error {
  constructor() {
    super("image exceeds the size limit");
    this.name = "ImageTooLargeError";
  }
}

export class BinderImageStore {
  constructor(private readonly dir: string) {}

  /**
   * Store a data URL, returning the id the binder should carry.
   *
   * Throws rather than returning null for an oversized image, because the two
   * failures need different words on screen: "that is not an image I can read"
   * is the user picking a PDF, and "too big" is a photo that needs resizing —
   * and the client resizes before uploading, so the second means something went
   * wrong rather than the user doing something unreasonable.
   */
  save(dataUrl: unknown): string | null {
    if (typeof dataUrl !== "string") return null;
    const match = DATA_URL.exec(dataUrl.trim());
    if (!match) return null;

    const ext = EXTENSIONS[match[1]];
    if (!ext) return null;

    const bytes = Buffer.from(match[2], "base64");
    if (bytes.byteLength === 0) return null;
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new ImageTooLargeError();

    const id = `${randomBytes(16).toString("base64url")}.${ext}`;
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, id), bytes);
    return id;
  }

  /** The bytes and their content type, or null when the id is unknown or malformed. */
  read(id: string): { body: Buffer; contentType: string } | null {
    if (!IMAGE_ID_PATTERN.test(id)) return null;
    const path = join(this.dir, id);
    if (!existsSync(path)) return null;
    try {
      return {
        body: readFileSync(path),
        contentType: MIME_BY_EXTENSION[id.slice(id.lastIndexOf(".") + 1)] ?? "application/octet-stream",
      };
    } catch {
      return null;
    }
  }

  /**
   * Delete images no live binder points at.
   *
   * The age floor is the whole safety argument. An image is uploaded BEFORE the
   * binder that references it is pushed — the client debounces sync by ten
   * seconds — so a sweep with no floor would delete a picture the user had just
   * placed, in the window before it was ever mentioned to the server. Seven
   * days is four orders of magnitude of headroom over that.
   */
  sweep(referenced: Set<string>, minAgeMs = 7 * 24 * 60 * 60_000, now = Date.now()): string[] {
    if (!existsSync(this.dir)) return [];
    const removed: string[] = [];
    for (const name of readdirSync(this.dir)) {
      if (!IMAGE_ID_PATTERN.test(name) || referenced.has(name)) continue;
      const path = join(this.dir, name);
      try {
        if (now - statSync(path).mtimeMs < minAgeMs) continue;
        rmSync(path);
        removed.push(name);
      } catch {
        // A file that cannot be stat'd or removed is left alone; an orphan
        // costs disk, and guessing here costs a picture.
      }
    }
    return removed;
  }
}
