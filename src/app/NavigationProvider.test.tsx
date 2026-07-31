import { beforeEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { NavigationProvider, useNavigation } from "./NavigationProvider.tsx";

function Probe() {
  const nav = useNavigation();
  return (
    <div>
      <span data-testid="screen">{nav.screen.name}</span>
      <span data-testid="canGoBack">{String(nav.canGoBack)}</span>
      <button onClick={() => nav.openSets()}>sets</button>
      <button onClick={() => nav.openSet("me5", "Pitch Black")}>set</button>
      <button onClick={() => nav.pop()}>back</button>
    </div>
  );
}

const at = () => screen.getByTestId("screen").textContent;
const click = (label: string) => act(() => screen.getByText(label).click());

beforeEach(() => {
  window.location.hash = "";
});

describe("glasses navigation (in-memory stack)", () => {
  it("pushes and pops without touching the URL", () => {
    render(
      <NavigationProvider>
        <Probe />
      </NavigationProvider>,
    );
    expect(at()).toBe("home");

    click("sets");
    expect(at()).toBe("sets");
    // The glasses have no URL bar; writing history there would be a second
    // source of truth for nothing.
    expect(window.location.hash).toBe("");

    click("back");
    expect(at()).toBe("home");
  });
});

describe("web navigation (browser history)", () => {
  it("writes a URL for each screen so a refresh or a link lands there", () => {
    render(
      <NavigationProvider urlBacked>
        <Probe />
      </NavigationProvider>,
    );
    click("set");
    expect(at()).toBe("set");
    expect(decodeURIComponent(window.location.hash)).toBe("#/set/me5/Pitch Black");
  });

  it("adopts the screen the URL already names on a cold load", () => {
    // Refreshing on a set used to dump you back at Home, because the stack only
    // ever lived in memory.
    window.location.hash = "#/sets";
    render(
      <NavigationProvider urlBacked>
        <Probe />
      </NavigationProvider>,
    );
    expect(at()).toBe("sets");
    // Still poppable, so the in-app Back control has something to do.
    expect(screen.getByTestId("canGoBack").textContent).toBe("true");
  });

  it("follows the browser's back button", () => {
    window.location.hash = "#/sets";
    render(
      <NavigationProvider urlBacked>
        <Probe />
      </NavigationProvider>,
    );
    expect(at()).toBe("sets");

    // What the phone's back gesture does. It used to leave the app entirely.
    act(() => {
      window.location.hash = "#/";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(at()).toBe("home");
  });

  it("lands on home when the URL names something unknown", () => {
    window.location.hash = "#/nonsense";
    render(
      <NavigationProvider urlBacked>
        <Probe />
      </NavigationProvider>,
    );
    expect(at()).toBe("home");
  });
});
