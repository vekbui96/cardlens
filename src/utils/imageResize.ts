/**
 * Shrink a picked image before it is uploaded.
 *
 * A phone photo is 3–8MB and 4000px wide. A binder pocket renders it at about
 * 120px. Uploading the original would cost the home server's residential upload
 * on the way in and every viewer's connection on the way out, for pixels
 * nothing can display — so it is resized on the device, where the file already
 * is, rather than on the server, where it would have to arrive first.
 */

/** Wide enough that a pocket stays sharp on a retina phone, small enough to be free. */
export const MAX_IMAGE_EDGE = 900;
export const IMAGE_QUALITY = 0.8;

/** The size an image becomes when fitted inside a square bound, aspect kept. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  // Never scale UP. A small logo dropped into a pocket should stay small rather
  // than being blown up into a blurry one at upload time.
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Read a file, fit it inside MAX_IMAGE_EDGE, and return a JPEG data URL.
 *
 * JPEG regardless of the input format: this is a photograph of a card or a
 * divider, and a 4000px PNG re-encoded as PNG stays enormous.
 */
export async function resizeToDataUrl(
  file: Blob,
  max = MAX_IMAGE_EDGE,
  quality = IMAGE_QUALITY,
): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, max);
    // A zero-dimension source is the "silent early return" shape this codebase
    // keeps being bitten by — the scanner had exactly this bug. Say so instead.
    if (width === 0 || height === 0) throw new Error("that image has no dimensions");

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("this device cannot resize images");
    ctx.drawImage(bitmap, 0, 0, width, height);

    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (!dataUrl.startsWith("data:image/jpeg")) throw new Error("this device cannot encode JPEG");
    return dataUrl;
  } finally {
    bitmap.close();
  }
}
