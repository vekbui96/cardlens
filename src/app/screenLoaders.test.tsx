import { afterEach, describe, expect, it, vi } from "vitest";
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
