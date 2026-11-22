import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_RELOAD_COOLDOWN_MS,
  AUTO_RELOAD_KEY,
  installStaleChunkRecovery,
  isChunkLoadError,
  recoverFromChunkError,
  reloadForUpdate,
  resetStaleChunkRecovery,
  staleChunkEnv,
} from "./staleChunk.ts";

const SAFARI = new TypeError("Importing a module script failed.");
const CHROME = new TypeError(
  "Failed to fetch dynamically imported module: https://vekbui96.github.io/cardlens/assets/index-Bs6lR8Xb.js",
);
const FIREFOX = new TypeError(
  "error loading dynamically imported module: https://vekbui96.github.io/cardlens/assets/index-Bs6lR8Xb.js",
);
const VITE_CSS = new Error("Unable to preload CSS for /cardlens/assets/index-Bs6lR8Xb.css");

/** Settles within a few microtasks, or is reported as still pending. */
async function outcome(promise: Promise<unknown>): Promise<"pending" | "resolved" | unknown> {
  const pending = Symbol("pending");
  const result = await Promise.race([
    promise.then(
      () => "resolved",
      (error: unknown) => error,
    ),
    new Promise((resolve) => setTimeout(() => resolve(pending), 20)),
  ]);
  return result === pending ? "pending" : result;
}

let now = 1_800_000_000_000;
let reload: ReturnType<typeof vi.fn>;
let refreshDocument: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sessionStorage.clear();
  resetStaleChunkRecovery();
  now = 1_800_000_000_000;
  reload = vi.fn();
  refreshDocument = vi.fn(() => Promise.resolve(true));
  vi.spyOn(staleChunkEnv, "reload").mockImplementation(reload);
  vi.spyOn(staleChunkEnv, "now").mockImplementation(() => now);
  vi.spyOn(staleChunkEnv, "online").mockReturnValue(true);
  vi.spyOn(staleChunkEnv, "refreshDocument").mockImplementation(refreshDocument);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isChunkLoadError", () => {
  it("recognises each engine's wording, and Vite's", () => {
    for (const error of [SAFARI, CHROME, FIREFOX, VITE_CSS]) expect(isChunkLoadError(error)).toBe(true);
  });

  it("leaves every other error alone", () => {
    expect(isChunkLoadError(new Error("cannot read printings of undefined"))).toBe(false);
    expect(isChunkLoadError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isChunkLoadError("Importing a module script failed.")).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });

  it("recognises anything Vite reported through vite:preloadError, whatever it says", () => {
    const target = new EventTarget() as Window;
    installStaleChunkRecovery(target);
    const odd = new Error("something new a future engine says");
    expect(isChunkLoadError(odd)).toBe(false);

    const event = Object.assign(new Event("vite:preloadError", { cancelable: true }), { payload: odd });
    target.dispatchEvent(event);

    expect(isChunkLoadError(odd)).toBe(true);
    // Not swallowed: the import that asked still rejects, and only a
    // render-path import decides to reload.
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("recoverFromChunkError", () => {
  it("reloads once for a stale chunk, and keeps the screen suspended meanwhile", async () => {
    expect(await outcome(recoverFromChunkError(SAFARI))).toBe("pending");
    expect(refreshDocument).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(AUTO_RELOAD_KEY)).toBe(String(now));
  });

  it("does not loop: right after an automatic reload, the error reaches the boundary", async () => {
    await outcome(recoverFromChunkError(SAFARI));
    resetStaleChunkRecovery(); // the page "reloaded"; module state is fresh
    now += 5_000;

    expect(await outcome(recoverFromChunkError(CHROME))).toBe(CHROME);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("allows another automatic reload once the cooldown has passed", async () => {
    await outcome(recoverFromChunkError(SAFARI));
    resetStaleChunkRecovery();
    now += AUTO_RELOAD_COOLDOWN_MS + 1;

    expect(await outcome(recoverFromChunkError(SAFARI))).toBe("pending");
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("makes one attempt when several screens fail at once", async () => {
    const results = await Promise.all([
      outcome(recoverFromChunkError(SAFARI)),
      outcome(recoverFromChunkError(SAFARI)),
    ]);
    expect(results).toEqual(["pending", "pending"]);
    expect(refreshDocument).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("rethrows any other error untouched, and never reloads for it", async () => {
    const bug = new Error("cannot read printings of undefined");
    expect(await outcome(recoverFromChunkError(bug))).toBe(bug);
    expect(refreshDocument).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(AUTO_RELOAD_KEY)).toBeNull();
  });

  it("never reloads while offline — that would replace the app with the browser's offline page", async () => {
    vi.mocked(staleChunkEnv.online).mockReturnValue(false);
    expect(await outcome(recoverFromChunkError(CHROME))).toBe(CHROME);

    vi.mocked(staleChunkEnv.online).mockReturnValue(true);
    refreshDocument.mockResolvedValue(false); // onLine said yes; the network said no
    expect(await outcome(recoverFromChunkError(CHROME))).toBe(CHROME);

    expect(reload).not.toHaveBeenCalled();
    // And a failed attempt does not use up the one reload.
    expect(sessionStorage.getItem(AUTO_RELOAD_KEY)).toBeNull();
  });

  it("does not reload when the guard cannot be kept, because storage throws", async () => {
    vi.spyOn(staleChunkEnv, "storage").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(await outcome(recoverFromChunkError(SAFARI))).toBe(SAFARI);
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload when the guard cannot be written", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(await outcome(recoverFromChunkError(SAFARI))).toBe(SAFARI);
    expect(reload).not.toHaveBeenCalled();
  });

  it("treats a garbage stored value as no previous reload", async () => {
    sessionStorage.setItem(AUTO_RELOAD_KEY, "not a number");
    expect(await outcome(recoverFromChunkError(SAFARI))).toBe("pending");
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("reloadForUpdate", () => {
  it("reloads even when the document could not be refreshed", async () => {
    refreshDocument.mockResolvedValue(false);
    reloadForUpdate();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it("is not limited by the automatic cooldown — someone asked for it", async () => {
    sessionStorage.setItem(AUTO_RELOAD_KEY, String(now));
    reloadForUpdate();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });
});
