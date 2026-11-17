import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MockInputAdapter } from "../integrations/meta/MockInputAdapter.ts";
import { InputProvider } from "../app/contexts.tsx";
import { useBackableFocus } from "./useBackableFocus.ts";

function setup(count: number) {
  const mock = new MockInputAdapter();
  const onSelect = vi.fn();
  const onBack = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <InputProvider value={{ adapter: mock, mock }}>{children}</InputProvider>
  );
  const view = renderHook(
    ({ count: c }: { count: number }) => useBackableFocus({ count: c, onSelect, onBack }),
    {
      wrapper,
      initialProps: { count },
    },
  );
  return { mock, onSelect, onBack, ...view };
}

describe("useBackableFocus", () => {
  it("starts focused on the first content item, not Back", () => {
    const { result } = setup(3);
    expect(result.current.backFocused).toBe(false);
    expect(result.current.itemIndex).toBe(0);
  });

  it("reaches Back by swiping up and activates it with SELECT (index pinch)", () => {
    const { mock, onBack, result } = setup(3);
    act(() => mock.swipeUp());
    expect(result.current.backFocused).toBe(true);
    expect(result.current.itemIndex).toBe(-1);
    act(() => mock.select());
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("selects content items by their own index", () => {
    const { mock, onSelect } = setup(3);
    act(() => mock.swipeDown());
    act(() => mock.select());
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("still supports middle-pinch BACK as a bonus", () => {
    const { mock, onBack } = setup(3);
    act(() => mock.back());
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("advances off Back to the first item when content first loads", () => {
    const { result, rerender } = setup(0);
    expect(result.current.backFocused).toBe(true);
    act(() => rerender({ count: 3 }));
    expect(result.current.itemIndex).toBe(0);
    expect(result.current.backFocused).toBe(false);
  });
});

describe("useBackableFocus resetFocusOn", () => {
  function setupReset(initial: { count: number; resetKey: string; resetTo?: number }) {
    const mock = new MockInputAdapter();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <InputProvider value={{ adapter: mock, mock }}>{children}</InputProvider>
    );
    const view = renderHook(
      ({ count, resetKey, resetTo }: { count: number; resetKey: string; resetTo?: number }) =>
        useBackableFocus({
          count,
          onSelect: () => {},
          onBack: () => {},
          resetFocusOn: resetKey,
          ...(resetTo === undefined ? {} : { resetTo }),
        }),
      { wrapper, initialProps: initial },
    );
    return { mock, ...view };
  }

  it("moves focus to the first item when the key changes, even though the count only shrank", () => {
    // A rarity swipe on a cached or local filter: the list is replaced without
    // ever passing through zero, so only the clamp used to run.
    const { mock, result, rerender } = setupReset({ count: 10, resetKey: "all" });
    for (let i = 0; i < 7; i++) act(() => mock.swipeDown());
    expect(result.current.itemIndex).toBe(7);
    act(() => rerender({ count: 2, resetKey: "ir" }));
    expect(result.current.itemIndex).toBe(0);
  });

  it("moves focus to the first item when the list grows back", () => {
    const { mock, result, rerender } = setupReset({ count: 2, resetKey: "ir" });
    act(() => mock.swipeDown());
    expect(result.current.itemIndex).toBe(1);
    act(() => rerender({ count: 10, resetKey: "all" }));
    expect(result.current.itemIndex).toBe(0);
  });

  it("leaves focus alone while the key stays the same", () => {
    const { mock, result, rerender } = setupReset({ count: 10, resetKey: "all" });
    act(() => mock.swipeDown());
    act(() => mock.swipeDown());
    act(() => rerender({ count: 9, resetKey: "all" }));
    expect(result.current.itemIndex).toBe(2);
  });

  it("targets resetTo, below rows of chrome", () => {
    const { mock, result, rerender } = setupReset({ count: 11, resetKey: "all", resetTo: 1 });
    for (let i = 0; i < 7; i++) act(() => mock.swipeDown());
    act(() => rerender({ count: 3, resetKey: "ir", resetTo: 1 }));
    expect(result.current.itemIndex).toBe(1);
  });

  it("lands on the target once it exists, if the new list was still loading", () => {
    const { mock, result, rerender } = setupReset({ count: 11, resetKey: "all", resetTo: 1 });
    for (let i = 0; i < 7; i++) act(() => mock.swipeDown());
    // Only the chrome row exists while the new filter loads.
    act(() => rerender({ count: 1, resetKey: "ir", resetTo: 1 }));
    expect(result.current.itemIndex).toBe(0);
    act(() => rerender({ count: 4, resetKey: "ir", resetTo: 1 }));
    expect(result.current.itemIndex).toBe(1);
  });

  it("drops a pending reset once the user has moved focus themselves", () => {
    const { mock, result, rerender } = setupReset({ count: 11, resetKey: "all", resetTo: 1 });
    for (let i = 0; i < 7; i++) act(() => mock.swipeDown());
    act(() => rerender({ count: 1, resetKey: "ir", resetTo: 1 }));
    act(() => mock.swipeUp());
    expect(result.current.backFocused).toBe(true);
    act(() => rerender({ count: 4, resetKey: "ir", resetTo: 1 }));
    expect(result.current.backFocused).toBe(true);
  });
});
