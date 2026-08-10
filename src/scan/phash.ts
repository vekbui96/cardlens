/**
 * Perceptual hashing for card recognition.
 *
 * The whole recognition strategy rests on one measurement: there are 20,460
 * cards in the English catalog (174 sets, measured from /api/catalog/sets). A
 * 64-bit hash each is 164KB — the entire index fits in a file smaller than one
 * card image, and matching is a Hamming distance over 20,460 integers, which is
 * sub-millisecond in plain JS. No wasm, no threads, no network, no model.
 *
 * That matters more here than it would elsewhere: the app is served from GitHub
 * Pages, which cannot set COOP/COEP headers, so there is no SharedArrayBuffer
 * and no wasm threading. OpenCV and Tesseract both run single-threaded. This
 * file is the one part of the pipeline the host cannot slow down.
 *
 * Everything here is PURE and takes raw RGBA. No canvas, no Image, no fetch —
 * because the index builder and the scanner must run byte-identical
 * preprocessing or accuracy quietly halves, and the only way to guarantee that
 * is to have one implementation both can call.
 */

/** Bits in a hash. Two uint32s rather than a BigInt: popcount is much faster. */
export const HASH_BITS = 64;
/** Working size before the DCT. 32 is the standard pHash choice. */
const SIZE = 32;
/** Low-frequency block kept from the DCT. 8x8 minus DC = 63 usable, padded to 64. */
const BLOCK = 8;

/**
 * Where the artwork sits on a card, as fractions of the card.
 *
 * Not the whole card, because the bottom third is rules text in a small font
 * that survives neither downscaling nor a phone camera, and the very edge is
 * where the card boundary detection is least accurate. Not just the art box
 * either: full-art and illustration-rare cards paint over it entirely, and
 * including a little of the frame is what keeps those distinguishable.
 */
export const ART_WINDOW = { x: 0.06, y: 0.08, w: 0.88, h: 0.62 } as const;

/** Cosine table: COS[u * SIZE + x] = cos((2x+1)·u·π / 2·SIZE). */
const COS = (() => {
  const table = new Float64Array(BLOCK * SIZE);
  for (let u = 0; u < BLOCK; u++) {
    for (let x = 0; x < SIZE; x++) {
      table[u * SIZE + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * SIZE));
    }
  }
  return table;
})();

const ALPHA = (() => {
  const a = new Float64Array(BLOCK);
  a[0] = Math.SQRT1_2;
  for (let u = 1; u < BLOCK; u++) a[u] = 1;
  return a;
})();

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The art window of a w×h card, in pixels. */
export function artRect(width: number, height: number): Rect {
  return {
    x: Math.round(width * ART_WINDOW.x),
    y: Math.round(height * ART_WINDOW.y),
    w: Math.round(width * ART_WINDOW.w),
    h: Math.round(height * ART_WINDOW.h),
  };
}

/**
 * Average a rectangle of RGBA down to SIZE×SIZE greyscale.
 *
 * A box filter, written out rather than delegated to canvas `drawImage`,
 * because the browser's resampling is not specified and differs between
 * engines — and any difference between how the index was built and how a scan
 * is processed shows up as lost accuracy that is very hard to attribute later.
 */
export function downscaleGrey(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  rect: Rect = { x: 0, y: 0, w: width, h: height },
): Float64Array {
  const out = new Float64Array(SIZE * SIZE);
  const cellW = rect.w / SIZE;
  const cellH = rect.h / SIZE;

  for (let cy = 0; cy < SIZE; cy++) {
    const y0 = Math.floor(rect.y + cy * cellH);
    const y1 = Math.max(y0 + 1, Math.floor(rect.y + (cy + 1) * cellH));
    for (let cx = 0; cx < SIZE; cx++) {
      const x0 = Math.floor(rect.x + cx * cellW);
      const x1 = Math.max(x0 + 1, Math.floor(rect.x + (cx + 1) * cellW));

      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1 && y < height; y++) {
        if (y < 0) continue;
        const row = y * width;
        for (let x = x0; x < x1 && x < width; x++) {
          if (x < 0) continue;
          const i = (row + x) * 4;
          // Rec. 601 luma. The alpha channel is ignored: every source here is
          // opaque, and honouring it would make a transparent PNG hash
          // differently from the same art composited onto white.
          sum += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
          n++;
        }
      }
      out[cy * SIZE + cx] = n > 0 ? sum / n : 0;
    }
  }
  return out;
}

/**
 * How much picture is in a region: the standard deviation of its greyscale, in
 * luma units.
 *
 * Answers a question the hash cannot — "is there anything here at all". A
 * perceptual hash is deliberately scale-free: it compares a region against its
 * own median, so an empty desk and a card produce hashes of exactly the same
 * shape and the same apparent confidence. That is correct for matching and
 * useless for deciding whether to fire a shutter, which is why auto-capture
 * previously photographed the mat between every pair of cards.
 *
 * Computed from the same 32×32 downscale the hash uses, so it is free on a path
 * that already pays for one.
 */
export function detail(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  rect?: Rect,
): number {
  const grey = downscaleGrey(rgba, width, height, rect);
  let sum = 0;
  for (const v of grey) sum += v;
  const mean = sum / grey.length;
  let variance = 0;
  for (const v of grey) variance += (v - mean) * (v - mean);
  return Math.sqrt(variance / grey.length);
}

/**
 * Top-left BLOCK×BLOCK coefficients of the 2D DCT-II.
 *
 * Separable and truncated: only 8 of 32 output frequencies are ever read, so
 * this is ~10k multiply-adds rather than the ~1M a naive full 2D DCT costs.
 */
function dctBlock(grey: Float64Array): Float64Array {
  // Rows first: rows[r * BLOCK + u]
  const rows = new Float64Array(SIZE * BLOCK);
  for (let r = 0; r < SIZE; r++) {
    const base = r * SIZE;
    for (let u = 0; u < BLOCK; u++) {
      let sum = 0;
      for (let x = 0; x < SIZE; x++) sum += grey[base + x] * COS[u * SIZE + x];
      rows[r * BLOCK + u] = sum * ALPHA[u];
    }
  }
  // Then columns.
  const out = new Float64Array(BLOCK * BLOCK);
  for (let v = 0; v < BLOCK; v++) {
    for (let u = 0; u < BLOCK; u++) {
      let sum = 0;
      for (let r = 0; r < SIZE; r++) sum += rows[r * BLOCK + u] * COS[v * SIZE + r];
      out[v * BLOCK + u] = sum * ALPHA[v];
    }
  }
  return out;
}

/**
 * A 64-bit perceptual hash of a region, as two uint32s.
 *
 * DCT-based rather than the simpler average hash: aHash compares pixels to the
 * mean brightness, which a phone light or a holo sheen moves wholesale. The DCT
 * throws away absolute brightness and keeps structure, which is exactly the
 * part of a card that does not change between the scan and the catalog image.
 */
export function perceptualHash(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  rect?: Rect,
): Uint32Array {
  const coeffs = dctBlock(downscaleGrey(rgba, width, height, rect));

  // The DC term carries overall brightness — the one thing we deliberately do
  // not want to be sensitive to — so it is excluded from the median and from
  // the hash, and bit 0 is spent on a duplicate of coefficient 1 to keep the
  // hash a round 64 bits.
  const sorted = Float64Array.from(coeffs.subarray(1)).sort();
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

  const hash = new Uint32Array(2);
  for (let bit = 0; bit < HASH_BITS; bit++) {
    const coeff = coeffs[bit === 0 ? 1 : bit];
    if (coeff > median) hash[bit >> 5] |= 1 << (bit % 32);
  }
  return hash;
}

/** Bits set in a 32-bit word (SWAR popcount). */
function popcount(n: number): number {
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  n = (n + (n >>> 4)) & 0x0f0f0f0f;
  return (n * 0x01010101) >>> 24;
}

/** Differing bits between two hashes held at word offsets in flat arrays. */
export function hamming(a: Uint32Array, ai: number, b: Uint32Array, bi: number): number {
  return popcount(a[ai] ^ b[bi]) + popcount(a[ai + 1] ^ b[bi + 1]);
}

export interface Match {
  /** Position in the index — resolve against the parallel metadata array. */
  ordinal: number;
  distance: number;
}

/**
 * The k nearest entries in an index of hashes (flat, 2 words per entry).
 *
 * Linear. At 20,460 entries that is 40,920 XORs and popcounts — well under a
 * millisecond — and a linear scan has no build step, no tree to keep balanced,
 * and no failure mode where a near neighbour is missed because it fell on the
 * wrong side of a partition.
 */
export function search(index: Uint32Array, hash: Uint32Array, k = 5): Match[] {
  const best: Match[] = [];
  let worst = HASH_BITS + 1;

  for (let i = 0, ord = 0; i < index.length; i += 2, ord++) {
    const d = hamming(hash, 0, index, i);
    if (best.length === k && d >= worst) continue;

    // Insertion sort into a k-element list: k is tiny, so this beats sorting
    // 20,460 candidates at the end by a wide margin.
    let at = best.length;
    while (at > 0 && best[at - 1].distance > d) at--;
    best.splice(at, 0, { ordinal: ord, distance: d });
    if (best.length > k) best.pop();
    worst = best[best.length - 1].distance;
  }
  return best;
}

export interface Verdict {
  match: Match | null;
  runnerUp: Match | null;
  /**
   * True when the best match is both close AND clearly better than the next.
   *
   * The margin matters more than the absolute distance. Two entries that match
   * almost equally well is the reprint case — same art, different set — and
   * that is precisely when the collector number has to settle it rather than
   * the artwork. Auto-accepting there is how a collection silently fills with
   * the wrong printings.
   */
  confident: boolean;
}

/**
 * Measured, not guessed — `node scripts/validate-recognition.mjs me5 me3 me2`.
 *
 * Real cards put through six realistic scan distortions (camera resample, 3%
 * crop error, dim room, holo glare, 3° tilt, and all of them at once), swept
 * across both thresholds:
 *
 *   maxDistance  minMargin   autoAccepted   falseAccept
 *           10           6          76.0%            0%
 *           14           6          90.1%          0.1%
 *           16           4          94.6%          0.1%
 *           16           6          91.4%          0.1%
 *           16           8          84.9%            0%   ← chosen
 *           24           8          84.9%            0%
 *
 * Two things fall out of that table, and neither was obvious beforehand:
 *
 * **The margin is the safety control, not the distance.** Every margin of 4 or
 * 6 leaks false accepts at every distance from 14 to 24; every margin of 8 is
 * clean at all of them. Tightening the distance instead — the intuitive move —
 * costs 9 points of auto-accept and fixes nothing that 8 does not fix better.
 *
 * **16 is the knee.** 18, 20 and 24 are identical to it, so a looser bound is
 * risk with no return.
 *
 * The chosen pair beats the obvious 10/6 on BOTH axes: more cards accepted
 * without asking, and no wrong ones. That matters because a false accept
 * silently files the wrong card and nobody ever notices, whereas being asked is
 * merely annoying.
 *
 * Supporting figure: across 69,751 impostor pairs the closest unrelated pair
 * was 12 bits. Re-run the sweep once the full 20,460-card index exists — that
 * is the number that can move, since near-collisions grow with the pair count.
 */
export const MAX_DISTANCE = 16;
export const MIN_MARGIN = 8;

export function judge(matches: Match[]): Verdict {
  const match = matches[0] ?? null;
  const runnerUp = matches[1] ?? null;
  if (!match) return { match: null, runnerUp: null, confident: false };
  const margin = runnerUp ? runnerUp.distance - match.distance : HASH_BITS;
  return {
    match,
    runnerUp,
    confident: match.distance <= MAX_DISTANCE && margin >= MIN_MARGIN,
  };
}
