import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RepositoriesProvider } from "../../app/contexts.tsx";
import { emptyBinder, setForTrade } from "../../models/binderLayout.ts";
import { Repositories } from "../../storage/repositories.ts";
import { BinderTradeBar } from "./BinderTradeBar.tsx";

/**
 * Handing a trade link over, and what happens when the browser refuses.
 *
 * The link is minted on the server first, so on a phone the share sheet is
 * asked for AFTER a network round trip — by which time the tap that allowed it
 * may have expired, and `navigator.share` rejects with `NotAllowedError`. That
 * rejection used to be swallowed exactly like a cancelled sheet: the button
 * changed to "Copy trade link" and nothing else happened. These tests pin the
 * fallback, and pin that a real cancel still says nothing.
 */

const NOW = Date.UTC(2026, 10, 17);
const binder = setForTrade(emptyBinder("b1", "Trades", "9", NOW), true, NOW);

function serve() {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: RequestInfo | URL) => {
      const href = String(url);
      const body = href.endsWith("/share/binder") ? { id: "abc123", binderName: "Trades" } : { shares: [] };
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
      );
    }),
  );
}

/** Called AFTER userEvent.setup(), which installs a clipboard stub of its own. */
function stubBrowser(share: (() => Promise<void>) | null, writeText: () => Promise<void>) {
  const shareFn = share ? vi.fn(share) : undefined;
  const writeFn = vi.fn(writeText);
  Object.defineProperty(navigator, "share", { configurable: true, value: shareFn });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: writeFn } });
  return { share: shareFn, writeText: writeFn };
}

const refused = () => Promise.reject(new DOMException("No user activation", "NotAllowedError"));
const cancelled = () => Promise.reject(new DOMException("Share canceled", "AbortError"));
const ok = () => Promise.resolve();

function renderBar() {
  return render(
    <RepositoriesProvider>
      <BinderTradeBar binder={binder} onSave={() => {}} />
    </RepositoriesProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  new Repositories().setSyncSettings({ token: "test-token" });
  serve();
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "share");
});

describe("BinderTradeBar sharing", () => {
  it("copies the link when the phone refuses the share sheet", async () => {
    const user = userEvent.setup();
    const { writeText } = stubBrowser(refused, ok);
    renderBar();

    await user.click(screen.getByRole("button", { name: "Share for trade" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("abc123")));
    expect(await screen.findByRole("button", { name: "Link copied" })).toBeInTheDocument();
  });

  it("shows the link with a Copy button when sharing and copying are both refused", async () => {
    const user = userEvent.setup();
    const { writeText } = stubBrowser(refused, refused);
    renderBar();

    await user.click(screen.getByRole("button", { name: "Share for trade" }));

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent(/Your browser would not share or copy the link/);
    const field = screen.getByRole("textbox", { name: /trade link/i });
    expect((field as HTMLInputElement).value).toContain("abc123");
    expect((field as HTMLInputElement).readOnly).toBe(true);
    expect(screen.queryByRole("button", { name: "Link copied" })).toBeNull();

    // The Copy button is a fresh tap, so the browser lets it through.
    writeText.mockImplementation(ok);
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining("abc123")));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("says nothing when the share sheet is cancelled", async () => {
    const user = userEvent.setup();
    const { share, writeText } = stubBrowser(cancelled, ok);
    renderBar();

    await user.click(screen.getByRole("button", { name: "Share for trade" }));

    await waitFor(() => expect(share).toHaveBeenCalled());
    await screen.findByRole("button", { name: "Copy trade link" });
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("copies directly where there is no share sheet", async () => {
    const user = userEvent.setup();
    const { writeText } = stubBrowser(null, ok);
    renderBar();

    await user.click(screen.getByRole("button", { name: "Share for trade" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("abc123")));
    expect(await screen.findByRole("button", { name: "Link copied" })).toBeInTheDocument();
  });
});
