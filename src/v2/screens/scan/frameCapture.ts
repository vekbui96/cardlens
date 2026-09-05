import { artRect, detail, perceptualHash } from "../../../scan/phash.ts";
import { guideRect, numberBandRect } from "../../../scan/frame.ts";

/**
 * One pass over the current video frame.
 *
 * Everything the screen needs from a frame comes out of a single crop-and-
 * downscale: the hash recognition uses, the detail figure auto-capture uses to
 * tell a card from an empty mat, the PNG the server is sent, and the
 * collector-number strip a person reads. Doing it in one place is what keeps
 * the 10fps detection loop to one pass per tick.
 */

/**
 * The size every index entry was built at.
 *
 * The crop is normalised to it so that camera resolution alone can never change
 * a hash — which is also why the collector number cannot come from this canvas:
 * at 245x342 the number is about 8px tall.
 */
export const CAPTURE_WIDTH = 245;
export const CAPTURE_HEIGHT = 342;

/** A thumbnail only has to be recognisable to a human reviewing a list. */
const THUMB_WIDTH = 82;

export interface Framed {
  hash: Uint32Array;
  /**
   * Greyscale spread of the art window. The hash cannot answer "is there
   * anything in the guide at all" — it is scale-free, so an empty desk hashes
   * with exactly the same apparent confidence as a card.
   */
  detail: number;
  /** 245x342, the canvas that is hashed and the canvas that is POSTed as PNG. */
  canvas: HTMLCanvasElement;
  /**
   * The collector-number strip at the CAMERA's own resolution — about 31px tall
   * off a 1080p frame against 8px off the canvas above. Shown, never read.
   */
  band: HTMLCanvasElement;
}

export function readFrame(video: HTMLVideoElement | null): Framed | null {
  if (!video || !video.videoWidth) return null;
  const guide = guideRect(video.videoWidth, video.videoHeight);

  const canvas = document.createElement("canvas");
  canvas.width = CAPTURE_WIDTH;
  canvas.height = CAPTURE_HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, guide.x, guide.y, guide.w, guide.h, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
  const frame = ctx.getImageData(0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);

  const bandRect = numberBandRect(guide);
  const band = document.createElement("canvas");
  band.width = bandRect.w;
  band.height = bandRect.h;
  band
    .getContext("2d")
    ?.drawImage(video, bandRect.x, bandRect.y, bandRect.w, bandRect.h, 0, 0, bandRect.w, bandRect.h);

  const art = artRect(CAPTURE_WIDTH, CAPTURE_HEIGHT);
  return {
    hash: perceptualHash(frame.data, CAPTURE_WIDTH, CAPTURE_HEIGHT, art),
    detail: detail(frame.data, CAPTURE_WIDTH, CAPTURE_HEIGHT, art),
    canvas,
    band,
  };
}

export function thumbnailOf(canvas: HTMLCanvasElement): string {
  const thumb = document.createElement("canvas");
  thumb.width = THUMB_WIDTH;
  thumb.height = Math.round((THUMB_WIDTH * CAPTURE_HEIGHT) / CAPTURE_WIDTH);
  thumb.getContext("2d")?.drawImage(canvas, 0, 0, thumb.width, thumb.height);
  return thumb.toDataURL("image/jpeg", 0.6);
}

/**
 * Higher quality than the thumbnail, deliberately: this one exists to be READ,
 * and JPEG artefacts on three small characters is exactly where they cost.
 */
export function bandImageOf(band: HTMLCanvasElement): string {
  return band.toDataURL("image/jpeg", 0.92);
}
