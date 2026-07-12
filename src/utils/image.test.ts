import { describe, expect, it } from "vitest";
import { optimizedImageUrl } from "./image.ts";

describe("optimizedImageUrl", () => {
  const src = "https://images.pokemontcg.io/sv3/223.png";

  it("returns undefined for a missing source", () => {
    expect(optimizedImageUrl(undefined, 120)).toBeUndefined();
  });

  it("builds a resized WebP CDN URL by default", () => {
    const url = optimizedImageUrl(src, 120)!;
    expect(url).toContain("wsrv.nl");
    expect(url).toContain(`url=${encodeURIComponent(src)}`);
    expect(url).toContain("w=120");
    expect(url).toContain("output=webp");
  });

  it("uses the requested width", () => {
    expect(optimizedImageUrl(src, 320)).toContain("w=320");
  });
});
