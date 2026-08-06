import { canonicalFinish } from "./finishes.ts";
import type { CollectFinish } from "./cards.ts";

/**
 * A shareable set showcase, encoded entirely into the link.
 *
 * The collection lives in the device's own storage and syncs behind a token, so
 * there is nothing a stranger could fetch. Rather than build public snapshot
 * endpoints — accounts, expiry, moderation, and a way to leak a collection by
 * guessing an id — the link CARRIES what it shows. Nothing is uploaded, nothing
 * is stored, and what you shared is exactly what you pasted.
 *
 * Keyed by collector number, not by index into the set. An index is smaller but
 * silently misaligns the moment the catalog's ordering changes, and a showcase
 * that quietly claims the wrong cards is worse than a long URL.
 */

/** Short codes for the common finishes; anything else rides as its full name. */
const CODES: Record<string, string> = {
  normal: "n",
  holo: "h",
  reverse: "r",
  firstEdition: "f",
  shadowless: "s",
};
const FROM_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(CODES).map(([finish, code]) => [code, finish]),
);

export interface ShowcasePrinting {
  collectorNumber: string;
  finish: CollectFinish;
  /**
   * When it was marked, present only on LIVE shares. Snapshot links encode
   * ownership alone and pre-date this, so anything reading it must treat
   * absence as "no history to draw" rather than as zero.
   */
  at?: number;
}

export interface Showcase {
  setId: string;
  owned: ShowcasePrinting[];
}

/** Base64url, so the payload survives a URL, a hash and a chat client. */
function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(encoded: string): string {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Pack owned printings into a URL-safe payload.
 *
 * `number:code` pairs, comma separated. Collector numbers never contain a colon
 * or a comma — they are digits with the occasional letter (`101a`, `TG01`,
 * `SV001`) — so the format needs no escaping and stays readable when debugging
 * a link someone says is broken.
 */
export function encodeShowcase(showcase: Showcase): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const p of showcase.owned) {
    const finish = canonicalFinish(p.finish);
    const key = `${p.collectorNumber}:${finish}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(`${p.collectorNumber}:${CODES[finish] ?? `~${finish}`}`);
  }
  return toBase64Url(parts.join(","));
}

/**
 * Unpack a payload. Never throws.
 *
 * A truncated or mangled link is the normal case, not the exception — chat
 * clients wrap, shorten and linkify. Anything unreadable yields the printings
 * that were readable rather than an error page, because a showcase missing
 * three cards is still worth looking at.
 */
export function decodeShowcase(setId: string, payload: string): Showcase {
  const owned: ShowcasePrinting[] = [];
  let text = "";
  try {
    text = fromBase64Url(payload);
  } catch {
    return { setId, owned };
  }

  for (const part of text.split(",")) {
    const at = part.indexOf(":");
    if (at <= 0) continue;
    const collectorNumber = part.slice(0, at);
    const code = part.slice(at + 1);
    if (!code) continue;
    const finish = code.startsWith("~") ? code.slice(1) : FROM_CODE[code];
    if (!finish) continue;
    owned.push({ collectorNumber, finish: canonicalFinish(finish) });
  }
  return { setId, owned };
}

/** Fast lookup of "is this printing in the showcase". */
export function showcaseIndex(showcase: Showcase): Set<string> {
  return new Set(showcase.owned.map((p) => `${p.collectorNumber}|${p.finish}`));
}
