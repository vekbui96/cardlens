import { describe, expect, it } from "vitest";
import { CARD_ASPECT, MIN_CROP, boxFromOutline, clampBox, defaultBox, dragBox, toPixels } from "./cropBox.ts";

const BOX = { x: 0.2, y: 0.2, w: 0.4, h: 0.5 };
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe("dragBox", () => {
  it("moves the whole box, but never off the photo", () => {
    expect(dragBox(BOX, "move", 0.1, -0.05)).toEqual({
      ...BOX,
      x: 0.30000000000000004,
      y: 0.15000000000000002,
    });
    const pinned = dragBox(BOX, "move", 5, 5);
    close(pinned.x, 0.6);
    close(pinned.y, 0.5);
    expect(pinned.w).toBe(BOX.w);
  });

  it("resizes from a corner, keeping the opposite corner still", () => {
    const b = dragBox(BOX, "nw", -0.1, -0.1);
    close(b.x, 0.1);
    close(b.y, 0.1);
    close(b.x + b.w, 0.6);
    close(b.y + b.h, 0.7);
    const se = dragBox(BOX, "se", 0.1, 0.2);
    close(se.w, 0.5);
    close(se.h, 0.7);
    expect(se.x).toBe(BOX.x);
  });

  it("stops at the minimum size instead of turning inside out", () => {
    const b = dragBox(BOX, "ne", -1, 1);
    close(b.w, MIN_CROP);
    close(b.h, MIN_CROP);
    expect(b.x).toBe(BOX.x);
    close(b.y + b.h, 0.7);
  });

  it("cannot drag a corner past the photo's edge", () => {
    const b = dragBox(BOX, "sw", -1, 1);
    expect(b.x).toBe(0);
    close(b.y + b.h, 1);
  });
});

describe("boxFromOutline", () => {
  it("is the upright rectangle around a tilted card, padded", () => {
    const b = boxFromOutline({
      topLeft: { x: 0.4, y: 0.3 },
      topRight: { x: 0.9, y: 0.25 },
      bottomRight: { x: 0.95, y: 0.85 },
      bottomLeft: { x: 0.45, y: 0.9 },
    });
    close(b.x, 0.38);
    close(b.y, 0.23);
    close(b.x + b.w, 0.97);
    close(b.y + b.h, 0.92);
  });
});

describe("defaultBox", () => {
  it("is card-shaped in pixels and centred, on a portrait photo", () => {
    const b = defaultBox(1200 / 1600);
    close((b.w * 1200) / (b.h * 1600), CARD_ASPECT);
    close(b.x + b.w / 2, 0.5);
    close(b.y + b.h / 2, 0.5);
  });

  it("fits a landscape photo too", () => {
    const b = defaultBox(1600 / 1200);
    close((b.w * 1600) / (b.h * 1200), CARD_ASPECT);
    expect(b.w).toBeLessThanOrEqual(0.9);
  });
});

describe("clampBox / toPixels", () => {
  it("pulls a box back inside the photo", () => {
    expect(clampBox({ x: 0.9, y: -0.2, w: 0.5, h: 0.01 })).toEqual({ x: 0.5, y: 0, w: 0.5, h: MIN_CROP });
  });

  it("converts to whole pixels, never empty or past the edge", () => {
    expect(toPixels({ x: 0.25, y: 0.5, w: 0.5, h: 0.5 }, 1200, 1600)).toEqual({
      sx: 300,
      sy: 800,
      sw: 600,
      sh: 800,
    });
    expect(toPixels({ x: 0.999, y: 0, w: 0.5, h: 0 }, 10, 10).sw).toBe(1);
  });
});
