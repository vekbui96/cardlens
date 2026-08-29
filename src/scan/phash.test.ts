import { describe, expect, it } from "vitest";
import {
  ART_WINDOW,
  HASH_BITS,
  MAX_DISTANCE,
  MIN_MARGIN,
  MIN_MARGIN_DRIFTED,
  NEAR_EXACT,
  artRect,
  downscaleGrey,
  hamming,
  judge,
  perceptualHash,
  search,
  type Match,
} from "./phash.ts";

/** An RGBA buffer from a per-pixel function. */
function image(width: number, height: number, at: (x: number, y: number) => [number, number, number]) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = at(x, y);
      const i = (y * width + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

/**
 * Deterministic texture — a stand-in for card art.
 *
 * A PURE function of (x, y): a stateful PRNG here returns different pixels
 * depending on how many times it has been called, so two images built from one
 * closure silently differ and every "same art" assertion fails at random-noise
 * distance. That is a fixture bug that looks exactly like a hashing bug.
 */
function noise(seed: number) {
  return (x: number, y: number): [number, number, number] => {
    let s = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1274126177)) >>> 0;
    s = (s ^ (s >>> 13)) >>> 0;
    s = Math.imul(s, 1274126177) >>> 0;
    s = (s ^ (s >>> 16)) >>> 0;
    const v = s & 0xff;
    return [v, v, v];
  };
}

const W = 245;
const H = 342;

describe("perceptualHash", () => {
  it("is stable: the same pixels always hash the same", () => {
    const img = image(W, H, noise(7));
    expect(Array.from(perceptualHash(img, W, H))).toEqual(Array.from(perceptualHash(img, W, H)));
  });

  it("ignores overall brightness", () => {
    // A phone light or a window moves every pixel together. The DC coefficient
    // carries exactly that and is excluded from the hash, so a true linear
    // change must come out identical rather than merely close.
    const base = noise(11);
    const dark = image(W, H, (x, y) => base(x, y).map((v) => v * 0.5) as [number, number, number]);
    const light = image(W, H, (x, y) => base(x, y).map((v) => v * 0.9) as [number, number, number]);

    expect(hamming(perceptualHash(dark, W, H), 0, perceptualHash(light, W, H), 0)).toBe(0);
  });

  it("degrades gracefully when highlights blow out", () => {
    // Glare is NOT a brightness change — it clips, and clipping genuinely
    // destroys structure that no amount of DC-invariance can recover. On real
    // card art the glare scan measured a mean distance of 11.1 bits, which is
    // why MAX_DISTANCE is 16 rather than something tight.
    const base = noise(11);
    const normal = image(W, H, (x, y) => base(x, y).map((v) => v * 0.6) as [number, number, number]);
    const glared = image(
      W,
      H,
      (x, y) => base(x, y).map((v) => Math.min(255, v * 1.9)) as [number, number, number],
    );

    const d = hamming(perceptualHash(normal, W, H), 0, perceptualHash(glared, W, H), 0);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThanOrEqual(10);
  });

  it("survives a resize, which is what a camera capture is", () => {
    // The catalog image and the scan are never the same size. If the hash
    // depended on resolution the index would be useless.
    const big = image(W * 2, H * 2, (x, y) => noise(3)(x >> 1, y >> 1));
    const small = image(W, H, noise(3));

    expect(hamming(perceptualHash(big, W * 2, H * 2), 0, perceptualHash(small, W, H), 0)).toBeLessThan(12);
  });

  it("tells genuinely different art apart", () => {
    const a = perceptualHash(image(W, H, noise(1)), W, H);
    const b = perceptualHash(image(W, H, noise(999)), W, H);
    // Unrelated images should land near the 32-bit expectation for random
    // 64-bit strings, nowhere near the accept threshold.
    expect(hamming(a, 0, b, 0)).toBeGreaterThan(20);
  });

  it("does not collapse a flat image into a degenerate hash", () => {
    // A blank frame — lens cap, table, a card that failed to detect — must not
    // produce a hash that happens to sit close to a real card.
    const flat = image(W, H, () => [128, 128, 128]);
    const hash = perceptualHash(flat, W, H);
    const bits = hamming(hash, 0, new Uint32Array(2), 0);
    expect(bits).toBeLessThanOrEqual(HASH_BITS);
  });
});

describe("artRect", () => {
  it("keeps the artwork and drops the rules text", () => {
    const rect = artRect(W, H);
    expect(rect.y).toBeGreaterThan(0);
    // The bottom third is small-font rules text that survives neither
    // downscaling nor a phone camera.
    expect(rect.y + rect.h).toBeLessThan(H * 0.75);
    expect(rect.x + rect.w).toBeLessThanOrEqual(W);
    expect(ART_WINDOW.w).toBeLessThan(1);
  });

  it("makes the hash ignore what changes outside the window", () => {
    const art = noise(21);
    const rect = artRect(W, H);
    // Same art, completely different borders — a sleeve, a different frame
    // colour, a scan that caught the table.
    const onWhite = image(W, H, (x, y) =>
      x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h ? art(x, y) : [255, 255, 255],
    );
    const onBlack = image(W, H, (x, y) =>
      x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h ? art(x, y) : [0, 0, 0],
    );

    const a = perceptualHash(onWhite, W, H, rect);
    const b = perceptualHash(onBlack, W, H, rect);
    expect(hamming(a, 0, b, 0)).toBe(0);
  });
});

describe("downscaleGrey", () => {
  it("averages rather than samples, so a single hot pixel cannot swing a cell", () => {
    const flat = image(64, 64, () => [100, 100, 100]);
    const spiked = image(64, 64, (x, y) => (x === 0 && y === 0 ? [255, 255, 255] : [100, 100, 100]));

    const a = downscaleGrey(flat, 64, 64);
    const b = downscaleGrey(spiked, 64, 64);
    // One pixel in a 2x2 box moves that cell by a quarter of the difference,
    // and nothing else at all.
    expect(b[0] - a[0]).toBeCloseTo(155 / 4, 1);
    expect(b[1]).toBeCloseTo(a[1], 6);
  });
});

describe("search", () => {
  const index = new Uint32Array([
    0x00000000,
    0x00000000, // 0: all zero
    0x0000000f,
    0x00000000, // 1: 4 bits from it
    0xffffffff,
    0xffffffff, // 2: the opposite
  ]);

  it("returns nearest first", () => {
    const hits = search(index, new Uint32Array([0x00000003, 0x00000000]), 3);
    expect(hits.map((h) => h.ordinal)).toEqual([0, 1, 2]);
    expect(hits[0].distance).toBe(2);
    expect(hits[1].distance).toBe(2 + 0);
  });

  it("caps at k without losing the best", () => {
    const hits = search(index, new Uint32Array([0xffffffff, 0xffffffff]), 1);
    expect(hits).toHaveLength(1);
    expect(hits[0].ordinal).toBe(2);
    expect(hits[0].distance).toBe(0);
  });
});

describe("judge", () => {
  const m = (distance: number, ordinal = 0): Match => ({ ordinal, distance });

  it("accepts a close match that is clearly better than the next", () => {
    expect(judge([m(3), m(20, 1)]).confident).toBe(true);
  });

  it("refuses a close match that has a close rival", () => {
    // Same art, two sets — a reprint. The artwork genuinely cannot decide this
    // and auto-accepting is how a collection fills with the wrong printings.
    expect(judge([m(4), m(5, 1)]).confident).toBe(false);
  });

  it("refuses a far match even with no rival", () => {
    // Past MAX_DISTANCE nothing is trustworthy, however lonely the candidate.
    expect(judge([m(28), m(52, 1)]).confident).toBe(false);
  });

  it("refuses a 6-bit margin, which is where the first false accepts were", () => {
    // Measured: every margin of 4 or 6 leaked ~0.1% confidently-wrong matches
    // at every distance from 14 to 24. This is the threshold protecting against
    // filing the wrong card silently, so it gets a test rather than only a
    // constant.
    expect(judge([m(9), m(15, 1)]).confident).toBe(false);
    expect(judge([m(9), m(19, 1)]).confident).toBe(true);
  });

  it("refuses an 8-bit margin, which is where the SECOND false accepts were", () => {
    // Margin 8 was clean when the index held 1,709 cards and is not clean now
    // that it holds 20,205 — `node scripts/measure-gate-safety.mjs report` finds
    // two confidently-wrong matches in 121,230 trials at 16/8 and none at 16/10.
    // Both are below; this pair is the boundary they sit on.
    expect(judge([m(9), m(17, 1)]).confident).toBe(false);
    expect(judge([m(9), m(18, 1)]).confident).toBe(false);
    expect(judge([m(9), m(19, 1)]).confident).toBe(true);
  });

  it("refuses the two measured false accepts, at their measured distances", () => {
    // bw2-32 "Emolga" under a 3% crop error landed 4 bits from mcd12-6, the
    // McDonald's 2012 reprint, with its own catalog image 12 bits away. Margin 8.
    expect(judge([m(4), m(12, 1)]).confident).toBe(false);
    // ex3-86 "Low Pressure System" landed 4 bits from pop3-11 the same way, with
    // the truth at 14 and the next rival at 13. Margin 9 — which is why 9 was
    // not enough and MIN_MARGIN is 10.
    expect(judge([m(4), m(13, 1)]).confident).toBe(false);
  });

  it("keeps the margin as the safety control, not the distance", () => {
    // Both measured false accepts sat at distance 4, the tightest and most
    // confident end of the accept region, so no plausible MAX_DISTANCE refuses
    // them — the sweep confirms 10 leaks exactly as 16 does. The refusal below
    // has to come from the margin, and this asserts that it does rather than
    // passing for the wrong reason if MAX_DISTANCE is ever tightened instead.
    const verdict = judge([m(4), m(13, 1)]);
    expect(verdict.match?.distance).toBeLessThan(MAX_DISTANCE);
    expect(verdict.confident).toBe(false);
    expect(MIN_MARGIN_DRIFTED).toBeGreaterThan(MIN_MARGIN);
  });

  it("trusts a near-exact hit at 8, and a drifted one only at 10", () => {
    // The whole point of the asymmetry. A blanket 10 refuses 312 cards that a
    // PERFECT capture would have matched — on a flawless capture the true hit
    // sits at distance 0 and its margin is whatever the catalog gave it.
    expect(judge([m(0), m(8, 1)]).confident).toBe(true);
    expect(judge([m(2), m(10, 1)]).confident).toBe(true);

    // The same 8-bit margin, from a query that has drifted, is refused.
    expect(judge([m(3), m(11, 1)]).confident).toBe(false);
    expect(judge([m(4), m(12, 1)]).confident).toBe(false);
  });

  it("does not let the lenient branch reach the measured false accepts", () => {
    // Both sat at distance 4, outside NEAR_EXACT, so they take the strict
    // branch. Widening NEAR_EXACT to 4 re-admits both — which is what says the
    // boundary was measured rather than tuned past.
    expect(NEAR_EXACT).toBeLessThan(4);
    expect(judge([m(4), m(12, 1)]).confident).toBe(false); // bw2-32 -> mcd12-6
    expect(judge([m(4), m(13, 1)]).confident).toBe(false); // ex3-86 -> pop3-11
  });
  it("accepts the glare case: further away, but still unmistakable", () => {
    // The realistic worst case measured a mean distance of 12.2 with impostors
    // no closer than 12 bits. Refusing this is what dropped auto-accept to 75%.
    expect(judge([m(14), m(31, 1)]).confident).toBe(true);
  });

  it("is not confident about nothing at all", () => {
    expect(judge([]).confident).toBe(false);
    expect(judge([]).match).toBeNull();
  });

  it("accepts a lone close match", () => {
    // Only one candidate came back — nothing to be ambiguous with.
    expect(judge([m(2)]).confident).toBe(true);
  });
});
