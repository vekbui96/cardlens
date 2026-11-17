/** What became of a link the user asked to share. */
export type HandOverResult = "shared" | "copied" | "cancelled" | "failed";

/**
 * Hand a URL over the way the device does it best, and say what happened.
 *
 * Both callers mint the link on the server FIRST and only then ask for the
 * share sheet. Browsers grant `navigator.share` and clipboard writes only
 * inside a fresh tap ("transient activation"), and WebKit's window is about a
 * second — a mint that crosses the Funnel can outlast it, and the share then
 * rejects with `NotAllowedError`. That used to be swallowed exactly like a
 * cancelled sheet, so the first tap did nothing at all and said nothing.
 *
 * So only `AbortError` — the user dismissing the sheet — counts as cancelled.
 * Anything else falls back to the clipboard, and if that is refused too the
 * caller is told `failed` and shows the link itself, where a fresh tap on
 * "Copy link" has the activation this one lost.
 */
export async function handOverLink(url: string, title: string): Promise<HandOverResult> {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, url });
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
      // Refused rather than dismissed: try the clipboard below.
    }
  }
  return (await copyLink(url)) ? "copied" : "failed";
}

/** Write a URL to the clipboard; false when there is none or it refuses. */
export async function copyLink(url: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}
