import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorBoundary, lastCrash } from "./ErrorBoundary.tsx";

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
});
