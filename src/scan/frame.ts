import type { Rect } from "./phash.ts";

/**
 * Where the card sits in the camera frame.
 *
 * M1 deliberately has NO quad detection. The user aligns the card to a printed
 * overlay and the frame is cropped to it — which sounds like a shortcut until
 * you look at what a 3% crop error actually costs: measured across 374 real
 * cards, top-1 accuracy was 99.7% and not a single false accept. OpenCV.js is
 * 8-11MB of wasm that cannot even use threads here (GitHub Pages cannot set
 * COOP/COEP), so detection has to earn its place against that number rather
 * than being assumed.
 *
 * A Pokémon card is 63mm x 88mm.
 */
export const CARD_ASPECT = 63 / 88;

/** How much of the frame's limiting dimension the guide occupies. */
const FILL = 0.82;

/**
 * The card-shaped crop, centred, in frame pixels.
 *
 * Returned in the SAME units the overlay is drawn in, so what the user lines
 * the card up against and what gets hashed cannot drift apart — the classic
 * way a scanner ends up hashing a region next to the one on screen.
 */
export function guideRect(frameWidth: number, frameHeight: number): Rect {
  const byHeight = frameHeight * FILL;
  const byWidth = (frameWidth * FILL) / CARD_ASPECT;
  const h = Math.min(byHeight, byWidth);
  const w = h * CARD_ASPECT;
  return {
    x: Math.round((frameWidth - w) / 2),
    y: Math.round((frameHeight - h) / 2),
    w: Math.round(w),
    h: Math.round(h),
  };
}

/** The guide as CSS percentages, for drawing the overlay over a video element. */
export function guideStyle(frameWidth: number, frameHeight: number) {
  const r = guideRect(frameWidth, frameHeight);
  const pct = (n: number, of: number) => `${((n / of) * 100).toFixed(3)}%`;
  return {
    left: pct(r.x, frameWidth),
    top: pct(r.y, frameHeight),
    width: pct(r.w, frameWidth),
    height: pct(r.h, frameHeight),
  };
}

/**
 * How much of the card's height, at the bottom, the collector number lives in.
 *
 * Generous on purpose. The number is printed bottom-LEFT on modern cards
 * (SWSH, SV) and bottom-RIGHT on most older ones, promos carry an alphanumeric
 * like `SWSH001` with no denominator at all, and full-art layouts move it
 * again. Building an era table to crop tighter would mean encoding a rule the
 * card index cannot even express — it stores `id, name, number, setId, setName,
 * rarity` and no geometry whatsoever.
 *
 * So this takes the full width of the bottom sixth and lets a human read it.
 * It sits entirely below ART_WINDOW (which ends at y = 0.70), so it can never
 * perturb the hash.
 */
const NUMBER_BAND_TOP = 0.84;

/**
 * The strip of the card that holds its collector number, in frame pixels.
 *
 * Taken from the guide at the camera's OWN resolution, which is the entire
 * point: the recognition path normalises to 245x342 so that resolution can
 * never change a hash, and at that size the number is about 8px tall — below
 * what a person can read and below what any OCR engine will touch. In the
 * 886x1237 a 1080p phone actually holds, it is about 31px.
 */
export function numberBandRect(guide: Rect): Rect {
  const top = Math.round(guide.y + guide.h * NUMBER_BAND_TOP);
  return { x: guide.x, y: top, w: guide.w, h: guide.y + guide.h - top };
}
