import { describe, expect, it } from "vitest";
import { navReducer, initialNavState, currentScreen, canGoBack, type NavState } from "./navigation.ts";

describe("navReducer", () => {
  it("starts on home and cannot go back", () => {
    expect(currentScreen(initialNavState).name).toBe("home");
    expect(canGoBack(initialNavState)).toBe(false);
  });

  it("pushes screens onto the stack", () => {
    const s1 = navReducer(initialNavState, { type: "PUSH", screen: { name: "results", query: "charizard" } });
    expect(currentScreen(s1)).toEqual({ name: "results", query: "charizard" });
    expect(canGoBack(s1)).toBe(true);
  });

  it("pops back to the previous screen", () => {
    let s: NavState = navReducer(initialNavState, { type: "PUSH", screen: { name: "favorites" } });
    s = navReducer(s, { type: "POP" });
    expect(currentScreen(s).name).toBe("home");
  });

  it("never pops the root home screen", () => {
    const s = navReducer(initialNavState, { type: "POP" });
    expect(currentScreen(s).name).toBe("home");
    expect(s.stack).toHaveLength(1);
  });

  it("replaces the top screen without growing the stack", () => {
    let s = navReducer(initialNavState, { type: "PUSH", screen: { name: "results", query: "a" } });
    s = navReducer(s, { type: "REPLACE", screen: { name: "results", query: "b" } });
    expect(currentScreen(s)).toEqual({ name: "results", query: "b" });
    expect(s.stack).toHaveLength(2);
  });

  it("HOME resets to the root", () => {
    let s = navReducer(initialNavState, { type: "PUSH", screen: { name: "favorites" } });
    s = navReducer(s, { type: "PUSH", screen: { name: "results", query: "x" } });
    s = navReducer(s, { type: "HOME" });
    expect(s.stack).toHaveLength(1);
    expect(currentScreen(s).name).toBe("home");
  });
});
