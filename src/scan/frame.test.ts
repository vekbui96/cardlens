import { describe, expect, it } from "vitest";
import { CARD_ASPECT, guideRect, guideStyle } from "./frame.ts";

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
