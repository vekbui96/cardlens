import { describe, expect, it } from "vitest";
import { CARD_ASPECT, guideRect, guideStyle, numberBandRect } from "./frame.ts";
import { ART_WINDOW } from "./phash.ts";

describe("guideRect", () => {
  it("keeps card proportions whatever shape the camera gives", () => {
    for (const [w, h] of [
      [1920, 1080],
      [1080, 1920],
      [640, 480],
      [1280, 720],
    ]) {
      const r = guideRect(w, h);
      expect(r.w / r.h, `${w}x${h}`).toBeCloseTo(CARD_ASPECT, 2);
    }
  });

  it("never runs outside the frame, including on a wide one", () => {
    // A landscape frame is the case that overflows if the guide is sized from
    // height alone — a card is taller than it is wide, so height is not the
    // limiting dimension there.
    for (const [w, h] of [
      [1920, 1080],
      [1080, 1920],
      [800, 800],
    ]) {
      const r = guideRect(w, h);
      expect(r.x, `${w}x${h} x`).toBeGreaterThanOrEqual(0);
      expect(r.y, `${w}x${h} y`).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w, `${w}x${h} right`).toBeLessThanOrEqual(w);
      expect(r.y + r.h, `${w}x${h} bottom`).toBeLessThanOrEqual(h);
    }
  });

  it("is centred", () => {
    const r = guideRect(1000, 800);
    expect(r.x + r.w / 2).toBeCloseTo(500, 0);
    expect(r.y + r.h / 2).toBeCloseTo(400, 0);
  });

  it("fills enough of the frame to be worth aiming at", () => {
    const r = guideRect(1080, 1920);
    expect(r.h / 1920).toBeGreaterThan(0.5);
  });
});

describe("guideStyle", () => {
  it("describes the same rectangle the crop uses", () => {
    // If these two ever disagree the user aligns the card to one region and the
    // scanner hashes another, which fails in a way that looks like bad
    // recognition rather than bad geometry.
    const [w, h] = [1080, 1920];
    const rect = guideRect(w, h);
    const style = guideStyle(w, h);

    expect(parseFloat(style.left)).toBeCloseTo((rect.x / w) * 100, 2);
    expect(parseFloat(style.top)).toBeCloseTo((rect.y / h) * 100, 2);
    expect(parseFloat(style.width)).toBeCloseTo((rect.w / w) * 100, 2);
    expect(parseFloat(style.height)).toBeCloseTo((rect.h / h) * 100, 2);
  });
});

describe("numberBandRect", () => {
  it("sits inside the guide, at its bottom, full width", () => {
    const guide = guideRect(1080, 1920);
    const band = numberBandRect(guide);

    expect(band.x).toBe(guide.x);
    expect(band.w).toBe(guide.w);
    // Flush with the bottom of the card: the number is printed on the edge.
    expect(band.y + band.h).toBe(guide.y + guide.h);
    expect(band.y).toBeGreaterThan(guide.y);
  });

  it("never overlaps the art window the hash is taken from", () => {
    // If it did, a change here could move a hash — and every card in the
    // shipped index was built at the current window.
    const guide = guideRect(1080, 1920);
    const band = numberBandRect(guide);
    const artBottom = guide.y + guide.h * (ART_WINDOW.y + ART_WINDOW.h);
    expect(band.y).toBeGreaterThan(artBottom);
  });

  it("is tall enough to read a collector number at camera resolution", () => {
    // The point of cropping from the video rather than the 245x342 canvas. A
    // collector number is roughly 2.5% of card height; the band must hold it
    // with room to spare, and at 1080p that means tens of pixels, not single
    // digits.
    const guide = guideRect(1080, 1920);
    const band = numberBandRect(guide);
    const numberHeight = guide.h * 0.025;

    expect(numberHeight).toBeGreaterThan(20);
    expect(band.h).toBeGreaterThan(numberHeight * 3);
  });

  it("scales with the frame rather than assuming a resolution", () => {
    for (const [w, h] of [
      [640, 480],
      [1080, 1920],
      [1920, 1080],
      [1440, 2560],
    ]) {
      const guide = guideRect(w, h);
      const band = numberBandRect(guide);
      expect(band.h).toBeGreaterThan(0);
      expect(band.y).toBeGreaterThanOrEqual(guide.y);
      expect(band.y + band.h).toBe(guide.y + guide.h);
    }
  });
});
