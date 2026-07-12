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
