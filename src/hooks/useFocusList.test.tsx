import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MockInputAdapter } from "../integrations/meta/MockInputAdapter.ts";
import { InputProvider } from "../app/contexts.tsx";
import { useFocusList } from "./useFocusList.ts";

function setup() {
  const mock = new MockInputAdapter();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <InputProvider value={{ adapter: mock, mock }}>{children}</InputProvider>
  );
  return { mock, wrapper };
}

describe("useFocusList", () => {
  it("moves focus with swipe up/down and clamps at the ends", () => {
    const { mock, wrapper } = setup();
    const { result } = renderHook(() => useFocusList({ count: 3, onSelect: () => {} }), { wrapper });

    expect(result.current.focusIndex).toBe(0);
    act(() => mock.swipeDown());
    expect(result.current.focusIndex).toBe(1);
    act(() => mock.swipeDown());
    act(() => mock.swipeDown()); // clamp at 2
    expect(result.current.focusIndex).toBe(2);
    act(() => mock.swipeUp());
    expect(result.current.focusIndex).toBe(1);
  });

  it("wraps when wrap=true", () => {
    const { mock, wrapper } = setup();
    const { result } = renderHook(() => useFocusList({ count: 2, wrap: true, onSelect: () => {} }), {
      wrapper,
    });
    act(() => mock.swipeUp()); // 0 -> wraps to 1
    expect(result.current.focusIndex).toBe(1);
  });

  it("fires onSelect with the focused index", () => {
    const { mock, wrapper } = setup();
    const onSelect = vi.fn();
    renderHook(() => useFocusList({ count: 3, onSelect }), { wrapper });
    act(() => mock.swipeDown());
    act(() => mock.select());
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("fires onBack for BACK events", () => {
    const { mock, wrapper } = setup();
    const onBack = vi.fn();
    renderHook(() => useFocusList({ count: 3, onSelect: () => {}, onBack }), { wrapper });
    act(() => mock.back());
    expect(onBack).toHaveBeenCalled();
  });

  it("does not select an empty list", () => {
    const { mock, wrapper } = setup();
    const onSelect = vi.fn();
    renderHook(() => useFocusList({ count: 0, onSelect }), { wrapper });
    act(() => mock.select());
    expect(onSelect).not.toHaveBeenCalled();
  });
});
