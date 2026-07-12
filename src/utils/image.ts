/**
 * Card images from images.pokemontcg.io are large PNGs (small ≈ 40 KB, hires ≈
 * 200 KB+), which are slow on a wearable's variable connection. We route them
 * through a resizing + caching image CDN (wsrv.nl) to get small WebP thumbnails,
 * with a fallback to the original URL if the CDN is unavailable.
 *
 * Set VITE_IMAGE_PROXY="" to disable and use the original URLs directly.
 */
function proxyBase(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const value = env?.VITE_IMAGE_PROXY;
  return value === undefined ? "https://wsrv.nl/" : value;
}

/** Resized + WebP URL for a source image, or the original when the proxy is off. */
export function optimizedImageUrl(src: string | undefined, width: number): string | undefined {
  if (!src) return undefined;
  const base = proxyBase();
  if (!base) return src;
  // w = target width, webp output, moderate quality, no upscaling (&we).
  return `${base}?url=${encodeURIComponent(src)}&w=${width}&output=webp&q=72&we`;
}
