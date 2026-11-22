import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorBoundary, lastCrash } from "./ErrorBoundary.tsx";
import { staleChunkEnv } from "./staleChunk.ts";

function Boom({ message }: { message: string }): never {
  throw new Error(message);
}

beforeEach(() => {
  localStorage.clear();
  // React logs caught errors itself; silence it so the suite output stays
  // readable without hiding a genuine failure.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ErrorBoundary", () => {
  it("renders children when nothing is wrong", () => {
    render(
      <ErrorBoundary>
        <p>fine</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("fine")).toBeInTheDocument();
  });

  it("shows the message instead of a blank page", () => {
    // Without this the whole tree unmounts and the only report available is
    // "it crashed" — which is unreproducible by construction.
    render(
      <ErrorBoundary>
        <Boom message="cannot read printings of undefined" />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("cannot read printings of undefined")).toBeInTheDocument();
  });

  it("leaves a way out that is not closing the app", () => {
    render(
      <ErrorBoundary>
        <Boom message="nope" />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("button", { name: "Go home" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy details" })).toBeInTheDocument();
  });

  it("persists the crash, because the first thing anyone does is reload", () => {
    render(
      <ErrorBoundary>
        <Boom message="gone on reload" />
      </ErrorBoundary>,
    );

    const saved = lastCrash() as { message: string; url: string } | null;
    expect(saved?.message).toBe("gone on reload");
    expect(saved?.url).toBeTruthy();
  });

  it("offers a reload in place when a deploy deleted a chunk", async () => {
    const reload = vi.spyOn(staleChunkEnv, "reload").mockImplementation(() => {});
    vi.spyOn(staleChunkEnv, "refreshDocument").mockResolvedValue(true);
    render(
      <ErrorBoundary>
        <Boom message="Failed to fetch dynamically imported module: https://x/assets/a.js" />
      </ErrorBoundary>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Go home" })).toBeInTheDocument();
  });

  it("offers no reload button for an ordinary error", () => {
    render(
      <ErrorBoundary>
        <Boom message="nope" />
      </ErrorBoundary>,
    );
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  });
});
