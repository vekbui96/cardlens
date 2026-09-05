import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  CatalogProvider,
  InputProvider,
  LayoutModeProvider,
  RepositoriesProvider,
} from "../../../app/contexts.tsx";
import { NavigationProvider } from "../../../app/NavigationProvider.tsx";
import { LibraryProvider } from "../../../app/LibraryProvider.tsx";
import { MockInputAdapter } from "../../../integrations/meta/MockInputAdapter.ts";
import { MockPokemonProvider } from "../../../integrations/pokemon/index.ts";
import { Repositories } from "../../../storage/repositories.ts";
import { clearAllStorage } from "../../../storage/versioned.ts";
import { TargetScreen } from "./TargetScreen.tsx";

/**
 * The Target screen's states, driven the way a person drives them.
 *
 * Two things are being defended here and neither is markup:
 *
 * 1. **The two tokens stay apart.** `TARGET_TOKEN` can reach a browser that
 *    puts items in a real cart; `COLLECTION_TOKEN` is on every device that
 *    holds cards. A screen that fell back to the collection token would work
 *    perfectly and be wrong, so the test asserts against STORAGE, not the UI.
 * 2. **A stopped bot reads as a stopped bot.** It is a scheduled task in a
 *    signed-in session on the home server, so it stops routinely, and "failed
 *    to load" would send someone to debug the app instead of signing in.
 */

/** The storage keys, spelled out — the separation is the thing under test. */
const TARGET_KEY = "cardlens:v1:target-settings";
const SYNC_KEY = "cardlens:v1:sync-settings";

const TARGET_TOKEN = "target-token-abc";
const COLLECTION_TOKEN = "collection-token-xyz";

function harness() {
  const client = new QueryClient({
    defaultOptions: {
      // The hook asks for `retry: 1` itself, deliberately — a home server blip
      // should not blank a screen. Zero delay keeps that honest and fast here.
      queries: { retryDelay: 0, gcTime: 0 },
      mutations: { retry: false, retryDelay: 0 },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
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
  };
}

interface Answer {
  status: number;
  body?: unknown;
}

/** Answers `/api/target/*` per method, and refuses everything else. */
function serve(routes: { state?: Answer; add?: Answer }) {
  const calls: { url: string; method: string; auth: string | null }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers as HeadersInit | undefined);
      calls.push({ url, method, auth: headers.get("authorization") });

      const answer =
        url.includes("/target/state") && method === "GET"
          ? routes.state
          : url.includes("/target/watchlist") && method === "POST"
            ? routes.add
            : undefined;

      if (!answer) return new Response(null, { status: 404 });
      return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
        status: answer.status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

const RUNTIME = {
  startedAt: "2026-09-01T10:00:00.000Z",
  lastCheckFinishedAt: "2026-09-01T10:05:00.000Z",
  checksCompleted: 42,
  blocked: false,
  blockBackoffSeconds: 0,
  checkIntervalSeconds: 60,
  storeId: "1234",
  paused: false,
  browserReady: true,
};

const PRODUCT = {
  tcin: "94336414",
  name: "Prismatic Evolutions Elite Trainer Box",
  url: "https://www.target.com/p/x/-/A-94336414",
  enabled: true,
  healthCheck: false,
  autoCart: false,
  lastStatus: "OUT",
  lastCheckedAt: "2026-09-01T10:05:00.000Z",
  lastAlertedAt: null,
  createdAt: "2026-08-01T10:00:00.000Z",
};

/** Put a target token on the device without going through the form. */
function connected() {
  new Repositories().setTargetSettings({ token: TARGET_TOKEN });
}

beforeEach(() => clearAllStorage());
afterEach(() => vi.unstubAllGlobals());

describe("with no token", () => {
  it("asks for one and says what it is, rather than looking broken", async () => {
    serve({});
    render(<TargetScreen />, { wrapper: harness() });

    expect(screen.getByLabelText("Watchlist token")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
    // Nothing on the screen claims a failure.
    expect(screen.queryByText(/failed|error/i)).toBeNull();
  });

  it("does NOT adopt the collection sync token, however present it is", async () => {
    // The failure this exists for would look like a feature: the device already
    // has a token, so the screen "just works" — against routes that can spend
    // money with a credential spread over every syncing device.
    new Repositories().setSyncSettings({ token: COLLECTION_TOKEN });
    const calls = serve({ state: { status: 200, body: { runtime: RUNTIME, products: [] } } });
    render(<TargetScreen />, { wrapper: harness() });

    expect(screen.getByLabelText("Watchlist token")).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes("/target/"))).toBe(false);
  });

  it("writes the token it is given to the target key, and leaves the sync key alone", async () => {
    const user = userEvent.setup();
    new Repositories().setSyncSettings({ token: COLLECTION_TOKEN });
    serve({ state: { status: 200, body: { runtime: RUNTIME, products: [] } } });
    render(<TargetScreen />, { wrapper: harness() });

    await user.type(screen.getByLabelText("Watchlist token"), TARGET_TOKEN);
    await user.click(screen.getByRole("button", { name: "Connect" }));

    await screen.findByRole("heading", { name: "The bot" });
    expect(localStorage.getItem(TARGET_KEY)).toContain(TARGET_TOKEN);
    // The collection token is untouched, and has not learned the target one.
    expect(localStorage.getItem(SYNC_KEY)).toContain(COLLECTION_TOKEN);
    expect(localStorage.getItem(SYNC_KEY)).not.toContain(TARGET_TOKEN);
  });

  it("sends the target token, and never the collection one, to the bot", async () => {
    connected();
    new Repositories().setSyncSettings({ token: COLLECTION_TOKEN });
    const calls = serve({ state: { status: 200, body: { runtime: RUNTIME, products: [] } } });
    render(<TargetScreen />, { wrapper: harness() });

    await screen.findByRole("heading", { name: "The bot" });
    const targetCalls = calls.filter((c) => c.url.includes("/target/"));
    expect(targetCalls.length).toBeGreaterThan(0);
    for (const call of targetCalls) {
      expect(call.auth).toBe(`Bearer ${TARGET_TOKEN}`);
      expect(call.auth).not.toContain(COLLECTION_TOKEN);
    }
  });
});

describe("when the bot is not running", () => {
  it("says so, and does not report a failure to load", async () => {
    // 503 is what the service answers when the bot's loopback API does not
    // reply — the ordinary consequence of SERVER-PC signing out.
    connected();
    serve({ state: { status: 503, body: { error: "target_bot_unreachable" } } });
    render(<TargetScreen />, { wrapper: harness() });

    expect(await screen.findByRole("heading", { name: "The bot is not running" })).toBeInTheDocument();
    expect(screen.queryByText(/failed to load/i)).toBeNull();
    expect(screen.queryByText(/something went wrong/i)).toBeNull();
  });

  it("explains that this is normal and offers to look again", async () => {
    connected();
    serve({ state: { status: 503, body: { error: "target_bot_unreachable" } } });
    render(<TargetScreen />, { wrapper: harness() });

    await screen.findByRole("heading", { name: "The bot is not running" });
    expect(screen.getByText(/scheduled task/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check again" })).toBeInTheDocument();
  });
});

describe("when the token is refused", () => {
  it("says the token was refused and offers a different one", async () => {
    connected();
    serve({ state: { status: 401, body: { error: "unauthorized" } } });
    render(<TargetScreen />, { wrapper: harness() });

    expect(await screen.findByRole("heading", { name: "The bot refused this token" })).toBeInTheDocument();
    expect(screen.getByText(/not the collection sync token/i)).toBeInTheDocument();
  });

  it("clearing the token returns to the connect form, and forgets only that token", async () => {
    const user = userEvent.setup();
    connected();
    new Repositories().setSyncSettings({ token: COLLECTION_TOKEN });
    serve({ state: { status: 401, body: { error: "unauthorized" } } });
    render(<TargetScreen />, { wrapper: harness() });

    await screen.findByRole("heading", { name: "The bot refused this token" });
    await user.click(screen.getByRole("button", { name: "Use a different token" }));

    expect(screen.getByLabelText("Watchlist token")).toBeInTheDocument();
    expect(localStorage.getItem(SYNC_KEY)).toContain(COLLECTION_TOKEN);
  });
});

describe("the watchlist", () => {
  it("says it is empty rather than showing nothing", async () => {
    connected();
    serve({ state: { status: 200, body: { runtime: RUNTIME, products: [] } } });
    render(<TargetScreen />, { wrapper: harness() });

    expect(await screen.findByText(/Nothing on the watchlist yet/i)).toBeInTheDocument();
    // And the way to fix it is right there.
    expect(screen.getByLabelText("Target link or TCIN")).toBeInTheDocument();
  });

  it("shows each product with its status and its own named controls", async () => {
    connected();
    serve({ state: { status: 200, body: { runtime: RUNTIME, products: [PRODUCT] } } });
    render(<TargetScreen />, { wrapper: harness() });

    expect(await screen.findByRole("link", { name: PRODUCT.name })).toHaveAttribute("href", PRODUCT.url);
    expect(screen.getByText("Out of stock")).toBeInTheDocument();
    // Named per product: twelve buttons all called "Remove" are twelve
    // identical buttons to anyone not looking at the screen.
    expect(screen.getByRole("button", { name: `Remove ${PRODUCT.name}` })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: `Watching ${PRODUCT.name}` })).toBeChecked();
  });

  it("shows the bot's own health, so a silent watchlist is not mistaken for a quiet one", async () => {
    connected();
    serve({
      state: { status: 200, body: { runtime: { ...RUNTIME, paused: true }, products: [PRODUCT] } },
    });
    render(<TargetScreen />, { wrapper: harness() });

    expect(await screen.findByText("Paused")).toBeInTheDocument();
    expect(screen.getByText(/Nothing is being checked/i)).toBeInTheDocument();
  });

  it("does not offer to remove the bot's own health check", async () => {
    connected();
    const canary = { ...PRODUCT, tcin: "1", name: "Canary", healthCheck: true };
    serve({ state: { status: 200, body: { runtime: RUNTIME, products: [canary] } } });
    render(<TargetScreen />, { wrapper: harness() });

    await screen.findByRole("link", { name: "Canary" });
    expect(screen.queryByRole("button", { name: "Remove Canary" })).toBeNull();
  });
});

describe("adding", () => {
  it("refuses something that is not a product before spending a round trip on it", async () => {
    const user = userEvent.setup();
    connected();
    const calls = serve({ state: { status: 200, body: { runtime: RUNTIME, products: [] } } });
    render(<TargetScreen />, { wrapper: harness() });

    await screen.findByText(/Nothing on the watchlist yet/i);
    await user.type(screen.getByLabelText("Target link or TCIN"), "a pack of cards");
    await user.click(screen.getByRole("button", { name: "Add to watchlist" }));

    expect(screen.getByText(/digits after A- in the URL/i)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("confirms an add, in words, and clears the form", async () => {
    const user = userEvent.setup();
    connected();
    serve({
      state: { status: 200, body: { runtime: RUNTIME, products: [] } },
      add: { status: 200, body: { ok: true } },
    });
    render(<TargetScreen />, { wrapper: harness() });

    await screen.findByText(/Nothing on the watchlist yet/i);
    const field = screen.getByLabelText("Target link or TCIN");
    await user.type(field, PRODUCT.url);
    await user.click(screen.getByRole("button", { name: "Add to watchlist" }));

    // An add drives a real browser for tens of seconds; saying nothing
    // afterwards is indistinguishable from silently failing.
    expect(await screen.findByText(/Added TCIN 94336414 to the watchlist/i)).toBeInTheDocument();
    expect(field).toHaveValue("");
  });

  it("says WHY an add failed, and that nothing was added", async () => {
    const user = userEvent.setup();
    connected();
    serve({
      state: { status: 200, body: { runtime: RUNTIME, products: [] } },
      add: { status: 503, body: { error: "target_bot_unreachable" } },
    });
    render(<TargetScreen />, { wrapper: harness() });

    await screen.findByText(/Nothing on the watchlist yet/i);
    await user.type(screen.getByLabelText("Target link or TCIN"), "94336414");
    await user.click(screen.getByRole("button", { name: "Add to watchlist" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/the bot is not running/i);
    expect(alert).toHaveTextContent(/nothing was added/i);
  });
});
