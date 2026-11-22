import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import {
  preloadableScreen,
  prefetchScreen,
  warmScreensWhenIdle,
  WEB_PREFETCH_TARGETS,
  WebBindersScreen,
  WebSetsScreen,
  type PrefetchTargets,
} from "./screenLoaders.tsx";
import { V2ErrorBoundary } from "../v2/shell/V2ErrorBoundary.tsx";
import { AUTO_RELOAD_KEY, resetStaleChunkRecovery, staleChunkEnv } from "./staleChunk.ts";

function Hello({ who }: { who: string }) {
  return <p>hello {who}</p>;
}

function setConnection(value: object | undefined) {
  Object.defineProperty(navigator, "connection", { value, configurable: true });
}

afterEach(() => {
  setConnection(undefined);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("preloadableScreen", () => {
  it("fetches its chunk once, however often it is prefetched", async () => {
    const load = vi.fn(() => Promise.resolve(Hello));
    const target = preloadableScreen(load);

    await Promise.all([target.prefetch(), target.prefetch()]);
    await target.prefetch();

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("renders a prefetched screen at once, with no Loading fallback", async () => {
    // The point of the whole change. Plain `lazy()` suspends on first render
    // even when its promise has already resolved, so this asserts the screen
    // is in the DOM SYNCHRONOUSLY after render, before any microtask runs.
    const target = preloadableScreen(() => Promise.resolve(Hello));
    await target.prefetch();

    render(
      <Suspense fallback={<p>Loading…</p>}>
        <target.Component who="Ve" />
      </Suspense>,
    );

    expect(screen.getByText("hello Ve")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("still loads a screen nobody prefetched, through the fallback, sharing the same fetch", async () => {
    const load = vi.fn(() => Promise.resolve(Hello));
    const target = preloadableScreen(load);

    render(
      <Suspense fallback={<p>Loading…</p>}>
        <target.Component who="tap" />
      </Suspense>,
    );
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(await screen.findByText("hello tap")).toBeInTheDocument();

    await target.prefetch();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("forgets a failed fetch, so the next attempt tries again", async () => {
    const load = vi
      .fn<() => Promise<typeof Hello>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(Hello);
    const target = preloadableScreen(load);

    await expect(target.prefetch()).rejects.toThrow("offline");
    await target.prefetch();

    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("preloadableScreen after a deploy deleted its chunk", () => {
  const stale = () => new TypeError("Importing a module script failed.");
  let reload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    resetStaleChunkRecovery();
    reload = vi.fn();
    vi.spyOn(staleChunkEnv, "reload").mockImplementation(reload);
    vi.spyOn(staleChunkEnv, "online").mockReturnValue(true);
    vi.spyOn(staleChunkEnv, "refreshDocument").mockResolvedValue(true);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  const renderScreen = (target: ReturnType<typeof preloadableScreen<{ who: string }>>) =>
    render(
      <V2ErrorBoundary>
        <Suspense fallback={<p>Loading…</p>}>
          <target.Component who="Ve" />
        </Suspense>
      </V2ErrorBoundary>,
    );

  it("reloads the page once, holding the fallback instead of the error screen", async () => {
    const target = preloadableScreen<{ who: string }>(() => Promise.reject(stale()));
    renderScreen(target);

    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not loop: straight after an automatic reload, it shows the error with a reloading Try again", async () => {
    sessionStorage.setItem(AUTO_RELOAD_KEY, String(Date.now()));
    vi.spyOn(staleChunkEnv, "now").mockReturnValue(Date.now() + 3_000);
    const target = preloadableScreen<{ who: string }>(() => Promise.reject(stale()));
    renderScreen(target);

    expect(await screen.findByRole("alert")).toHaveTextContent("Importing a module script failed.");
    expect(reload).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it("never reloads for a prefetch — only a screen being shown may", async () => {
    const target = preloadableScreen<{ who: string }>(() => Promise.reject(stale()));
    await expect(target.prefetch()).rejects.toThrow("Importing a module script failed.");
    expect(reload).not.toHaveBeenCalled();
  });

  it("leaves a screen that throws for any other reason to the boundary, with no reload", async () => {
    const target = preloadableScreen<{ who: string }>(() =>
      Promise.reject(new Error("syntax error in chunk")),
    );
    renderScreen(target);

    expect(await screen.findByRole("alert")).toHaveTextContent("syntax error in chunk");
    expect(reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(AUTO_RELOAD_KEY)).toBeNull();
  });
});

describe("prefetchScreen", () => {
  const fakeTargets = () => {
    const prefetch = vi.fn(() => Promise.resolve());
    return { prefetch, targets: { binders: { prefetch } } satisfies PrefetchTargets };
  };

  it("warms the screen on the web", async () => {
    const { prefetch, targets } = fakeTargets();
    await expect(prefetchScreen("binders", "web", targets)).resolves.toBe(true);
    expect(prefetch).toHaveBeenCalledTimes(1);
  });

  it("never fetches anything for the glasses or the preview bezel", async () => {
    const { prefetch, targets } = fakeTargets();
    await expect(prefetchScreen("binders", "glasses", targets)).resolves.toBe(false);
    await expect(prefetchScreen("binders", "preview", targets)).resolves.toBe(false);
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("stays off a connection that asked to save data, or a 2G one", async () => {
    const { prefetch, targets } = fakeTargets();
    setConnection({ saveData: true });
    await expect(prefetchScreen("binders", "web", targets)).resolves.toBe(false);
    setConnection({ saveData: false, effectiveType: "slow-2g" });
    await expect(prefetchScreen("binders", "web", targets)).resolves.toBe(false);
    setConnection({ saveData: false, effectiveType: "2g" });
    await expect(prefetchScreen("binders", "web", targets)).resolves.toBe(false);
    expect(prefetch).not.toHaveBeenCalled();

    setConnection({ saveData: false, effectiveType: "4g" });
    await expect(prefetchScreen("binders", "web", targets)).resolves.toBe(true);
  });

  it("swallows a failure rather than surfacing it", async () => {
    const targets: PrefetchTargets = { binders: { prefetch: () => Promise.reject(new Error("offline")) } };
    await expect(prefetchScreen("binders", "web", targets)).resolves.toBe(false);
  });

  it("does nothing for a screen with no target", async () => {
    await expect(prefetchScreen("trade", "web", {})).resolves.toBe(false);
  });

  it("warms the exact object ScreenRouter renders", () => {
    // Same object, so the same memoised loader: a prefetch that warmed a
    // different promise would leave the tap waiting all over again.
    expect(WEB_PREFETCH_TARGETS.binders).toBe(WebBindersScreen);
    expect(WEB_PREFETCH_TARGETS.collection).toBe(WebSetsScreen);
    expect(WEB_PREFETCH_TARGETS.sets).toBe(WebSetsScreen);
  });
});

describe("warmScreensWhenIdle", () => {
  it("warms in order, one at a time, after the page goes idle", async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    let release: () => void = () => {};
    const targets: PrefetchTargets = {
      binders: {
        prefetch: () =>
          new Promise<void>((resolve) => {
            order.push("binders");
            release = resolve;
          }),
      },
      owned: { prefetch: async () => void order.push("owned") },
    };

    warmScreensWhenIdle(["binders", "owned"], "web", targets);
    expect(order).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    // The second waits for the first.
    expect(order).toEqual(["binders"]);

    await act(async () => {
      release();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(order).toEqual(["binders", "owned"]);
  });

  it("stops at the first failure", async () => {
    vi.useFakeTimers();
    const owned = vi.fn(() => Promise.resolve());
    const targets: PrefetchTargets = {
      binders: { prefetch: () => Promise.reject(new Error("offline")) },
      owned: { prefetch: owned },
    };

    warmScreensWhenIdle(["binders", "owned"], "web", targets);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(owned).not.toHaveBeenCalled();
  });

  it("does nothing once cancelled, and nothing at all on the glasses", async () => {
    vi.useFakeTimers();
    const binders = vi.fn(() => Promise.resolve());
    const targets: PrefetchTargets = { binders: { prefetch: binders } };

    const cancel = warmScreensWhenIdle(["binders"], "web", targets);
    cancel();
    warmScreensWhenIdle(["binders"], "glasses", targets);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(binders).not.toHaveBeenCalled();
  });
});
