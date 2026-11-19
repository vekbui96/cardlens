import type { CardOutline } from "../models/identify.ts";

/**
 * The hand-drawn crop for a photo the engine could not find the card in.
 *
 * Everything is a FRACTION of the photo (0..1 on each axis), so one box means
 * the same region on the 720px preview the person drags it over and on the
 * 1600px upload that is actually cropped. Pure, so the dragging rules are
 * testable without a pointer.
 */
export interface CropBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What is being dragged: the whole box, or one corner. */
export type CropHandle = "move" | "nw" | "ne" | "se" | "sw";

/** Smallest box, per axis. Below this the crop is a few hundred pixels of nothing. */
export const MIN_CROP = 0.08;

/** A Pokémon card is 63 x 88 mm. */
export const CARD_ASPECT = 63 / 88;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Inside the photo and at least MIN_CROP each way. */
export function clampBox(b: CropBox): CropBox {
  const w = clamp(b.w, MIN_CROP, 1);
  const h = clamp(b.h, MIN_CROP, 1);
  return { x: clamp(b.x, 0, 1 - w), y: clamp(b.y, 0, 1 - h), w, h };
}

/**
 * The box after dragging `handle` by (dx, dy), both fractions of the photo.
 * Always computed from the box at the START of the drag, so a long drag does
 * not accumulate rounding, and a corner dragged past its opposite stops at the
 * minimum size instead of flipping the box inside out.
 */
export function dragBox(start: CropBox, handle: CropHandle, dx: number, dy: number): CropBox {
  if (handle === "move") {
    return {
      ...start,
      x: clamp(start.x + dx, 0, 1 - start.w),
      y: clamp(start.y + dy, 0, 1 - start.h),
    };
  }
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  if (handle === "nw" || handle === "sw") left = clamp(left + dx, 0, right - MIN_CROP);
  if (handle === "ne" || handle === "se") right = clamp(right + dx, left + MIN_CROP, 1);
  if (handle === "nw" || handle === "ne") top = clamp(top + dy, 0, bottom - MIN_CROP);
  if (handle === "sw" || handle === "se") bottom = clamp(bottom + dy, top + MIN_CROP, 1);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** The upright rectangle around the engine's outline, with a little margin. */
export function boxFromOutline(outline: CardOutline, pad = 0.02): CropBox {
  const pts = [outline.topLeft, outline.topRight, outline.bottomRight, outline.bottomLeft];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.max(0, Math.min(...xs) - pad);
  const y = Math.max(0, Math.min(...ys) - pad);
  return clampBox({
    x,
    y,
    w: Math.min(1, Math.max(...xs) + pad) - x,
    h: Math.min(1, Math.max(...ys) + pad) - y,
  });
}

/**
 * A card-shaped box in the middle of the photo, for when nothing better is
 * known. `photoAspect` is the photo's width / height.
 */
export function defaultBox(photoAspect: number): CropBox {
  const aspect = Number.isFinite(photoAspect) && photoAspect > 0 ? photoAspect : 3 / 4;
  let h = 0.7;
  let w = (CARD_ASPECT * h) / aspect;
  if (w > 0.9) {
    h *= 0.9 / w;
    w = 0.9;
  }
  return clampBox({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
}

/** The box in whole pixels of a `width` x `height` image, never empty. */
export function toPixels(box: CropBox, width: number, height: number) {
  const sx = Math.round(clamp(box.x, 0, 1) * width);
  const sy = Math.round(clamp(box.y, 0, 1) * height);
  return {
    sx,
    sy,
    sw: Math.max(1, Math.min(width - sx, Math.round(box.w * width))),
    sh: Math.max(1, Math.min(height - sy, Math.round(box.h * height))),
  };
}
