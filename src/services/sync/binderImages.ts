import { apiBaseUrl, syncRequest } from "./http.ts";

/**
 * Custom binder art: uploaded once, referenced by id.
 *
 * The binder stores the id, never the bytes and never a URL. A URL would be
 * wrong on every device but the one that uploaded it — a phone reaching the
 * funnel and a dev build on localhost resolve the same image differently — and
 * the bytes would be re-pushed on every pocket move.
 */

export interface UploadedImage {
  id: string;
}

/** Where a stored image actually lives, for this device, right now. */
export function binderImageUrl(imageId: string, base: string = apiBaseUrl()): string {
  return `${base}/binders/images/${encodeURIComponent(imageId)}`;
}

/** The src for a pocket's image, whichever way it was supplied. */
export function imageSlotSrc(
  slot: { imageId?: string; src?: string },
  base: string = apiBaseUrl(),
): string | undefined {
  if (slot.imageId) return binderImageUrl(slot.imageId, base);
  return slot.src;
}

export async function uploadBinderImage(
  token: string,
  dataUrl: string,
  base: string = apiBaseUrl(),
): Promise<string> {
  const result = await syncRequest<UploadedImage>(base, token, "/binders/images", {
    method: "POST",
    body: JSON.stringify({ dataUrl }),
  });
  if (!result?.id) throw new Error("the server accepted the image but returned no id");
  return result.id;
}
