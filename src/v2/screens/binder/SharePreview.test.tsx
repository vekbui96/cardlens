import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  InputProvider,
  CatalogProvider,
  RepositoriesProvider,
  LayoutModeProvider,
} from "../../../app/contexts.tsx";
import { NavigationProvider } from "../../../app/NavigationProvider.tsx";
import { LibraryProvider } from "../../../app/LibraryProvider.tsx";
import { MockInputAdapter } from "../../../integrations/meta/MockInputAdapter.ts";
import { MockPokemonProvider } from "../../../integrations/pokemon/index.ts";
import { clearAllStorage } from "../../../storage/versioned.ts";
import { Repositories } from "../../../storage/repositories.ts";
import { emptyBinder, placeSlot, type Binder, type CardSlot } from "../../../models/binderLayout.ts";
import { SharePreview } from "./SharePreview.tsx";

/**
 * Share on the v2 Binder screen: the visitor's page first, the link after.
 *
 * Pinned: nothing goes to the server until Copy link is pressed; Copy link is
 * the existing mint (one POST to /share/binder) and copies the same
 * `#/trade/<id>` address; a failure is the shared ErrorNotice; Back closes and
 * hands focus back to the Share button; the tab title is not touched.
 */

const NOW = 1_800_000_000_000;

const card = (n: string, name: string): CardSlot => ({
  kind: "card",
  cardId: `me5-${n}`,
  finish: "normal",
  collectorNumber: n,
  name,
  imageSmall: `https://images.pokemontcg.io/me5/${n}.png`,
});

function binderWithCards(): Binder {
  let b = emptyBinder("b1", "Jolteon", "9", NOW);
  b = placeSlot(b, 0, 0, card("1", "Jolteon"), NOW);
  b = placeSlot(b, 0, 1, card("2", "Vaporeon"), NOW);
  return b;
}

function Host({ binder, onClose }: { binder: Binder; onClose: () => void }) {
  const ref = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button type="button" ref={ref}>
        Share
      </button>
      <SharePreview binder={binder} onClose={onClose} returnFocus={ref} />
    </>
  );
}

function renderPreview(onClose: () => void = () => {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (children: ReactNode) => (
    <QueryClientProvider client={client}>
      <InputProvider value={{ adapter: new MockInputAdapter(), mock: new MockInputAdapter() }}>
        <RepositoriesProvider>
          <CatalogProvider base={new MockPokemonProvider({})}>
            <LayoutModeProvider mode="web">
              <NavigationProvider>
                <LibraryProvider>{children}</LibraryProvider>
              </NavigationProvider>
            </LayoutModeProvider>
          </CatalogProvider>
        </RepositoriesProvider>
      </InputProvider>
    </QueryClientProvider>
  );
  return render(wrap(<Host binder={binderWithCards()} onClose={onClose} />));
}

type Answer = { status: number; body: unknown };

function serve(mint: Answer) {
  const fetchMock = vi.fn((url: RequestInfo | URL) => {
    const href = String(url);
    const answer = href.endsWith("/share/binder") ? mint : { status: 200, body: {} };
    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function mintCalls(fetchMock: ReturnType<typeof serve>) {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/share/binder"));
}

beforeEach(() => {
  clearAllStorage();
  localStorage.clear();
  new Repositories().setSyncSettings({ token: "test-token" });
  document.title = "Binder · CardLens";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SharePreview", () => {
  it("shows what a visitor sees before anything is shared", () => {
    const fetchMock = serve({ status: 200, body: { id: "abc123", binderName: "Jolteon" } });
    renderPreview();

    const dialog = screen.getByRole("dialog", { name: "What a visitor sees: Jolteon" });
    expect(within(dialog).getByRole("heading", { name: "What a visitor sees" })).toBeInTheDocument();
    // The visitor page itself, drawn from this binder.
    expect(within(dialog).getByRole("list", { name: "Cards in this binder" })).toBeInTheDocument();
    expect(within(dialog).getAllByText("Vaporeon").length).toBeGreaterThan(0);
    expect(within(dialog).getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Back" })).toBeInTheDocument();
    // Looking is free: no link is minted until Copy link.
    expect(mintCalls(fetchMock)).toHaveLength(0);
    expect(document.title).toBe("Binder · CardLens");
  });

  it("Copy link mints once and copies the trade address", async () => {
    const user = userEvent.setup();
    const fetchMock = serve({ status: 200, body: { id: "abc123", binderName: "Jolteon" } });
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderPreview();

    await user.click(screen.getByRole("button", { name: "Copy link" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/#\/trade\/abc123$/)));
    expect(mintCalls(fetchMock)).toHaveLength(1);
    expect(await screen.findByRole("button", { name: "Link copied" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a failed share uses the shared ErrorNotice, and Try again retries", async () => {
    const user = userEvent.setup();
    const fetchMock = serve({ status: 500, body: { error: "boom" } });
    renderPreview();

    await user.click(screen.getByRole("button", { name: "Copy link" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not reach the server to make a share link.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(mintCalls(fetchMock).length).toBeGreaterThanOrEqual(2));
  });

  it("without a sync token, says to connect first and asks nothing of the server", async () => {
    const user = userEvent.setup();
    localStorage.clear();
    const fetchMock = serve({ status: 200, body: { id: "abc123" } });
    renderPreview();

    await user.click(screen.getByRole("button", { name: "Copy link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Connect this device to the server first/);
    expect(mintCalls(fetchMock)).toHaveLength(0);
  });

  it("Back and Escape close it", async () => {
    const user = userEvent.setup();
    serve({ status: 200, body: { id: "abc123" } });
    const onClose = vi.fn();
    renderPreview(onClose);

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
