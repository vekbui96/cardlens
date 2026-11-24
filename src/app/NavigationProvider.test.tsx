import { beforeEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { NavigationProvider, useNavigation } from "./NavigationProvider.tsx";
import { readBrowseList, rememberBrowseList } from "../v2/screens/details/browseList.ts";

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

describe("remembered browse list", () => {
  function ListProbe() {
    const nav = useNavigation();
    return (
      <div>
        <span data-testid="screen">{nav.screen.name}</span>
        <button onClick={() => nav.openResults("pika")}>results</button>
        <button onClick={() => nav.openDetails("sv3-1")}>details</button>
        <button onClick={() => nav.push({ name: "wantlist" })}>wantlist</button>
        <button onClick={() => nav.home()}>home</button>
      </div>
    );
  }

  beforeEach(() => sessionStorage.clear());

  // Mounting on Home clears any list, so each test remembers one AFTER the render.
  const remember = () => rememberBrowseList("Search results", [{ cardId: "sv3-1" }, { cardId: "sv3-2" }]);

  it("keeps the list across the lists it came from and card details", () => {
    render(
      <NavigationProvider>
        <ListProbe />
      </NavigationProvider>,
    );
    remember();
    click("results");
    click("details");
    expect(at()).toBe("details");
    expect(readBrowseList()).toEqual({ label: "Search results", cardIds: ["sv3-1", "sv3-2"] });
  });

  it("forgets the list on the Want list, so a card opened there has no stale arrows", () => {
    render(
      <NavigationProvider>
        <ListProbe />
      </NavigationProvider>,
    );
    click("results");
    remember();
    click("wantlist");
    expect(at()).toBe("wantlist");
    expect(readBrowseList()).toBeNull();
  });

  it("forgets the list when the collector goes Home", () => {
    render(
      <NavigationProvider>
        <ListProbe />
      </NavigationProvider>,
    );
    click("details");
    remember();
    click("home");
    expect(at()).toBe("home");
    expect(readBrowseList()).toBeNull();
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
