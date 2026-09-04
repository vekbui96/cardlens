import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { V2ErrorBoundary } from "./V2ErrorBoundary.tsx";

function Boom({ message }: { message: string }): never {
  throw new Error(message);
}

beforeEach(() => {
  // React logs every caught error itself; silence it so a passing suite is
  // readable, without hiding a failure.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe("V2ErrorBoundary", () => {
  it("shows the failure instead of a blank page", () => {
    render(
      <V2ErrorBoundary>
        <Boom message="pockets exploded" />
      </V2ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("pockets exploded")).toBeInTheDocument();
  });

  it("renders children when nothing throws", () => {
    render(
      <V2ErrorBoundary>
        <p>fine</p>
      </V2ErrorBoundary>,
    );
    expect(screen.getByText("fine")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("recovers when the route changes", () => {
    // Without this a single bad screen wedges the whole app until a reload —
    // navigating away from it would keep showing its error.
    const { rerender } = render(
      <V2ErrorBoundary resetKey="binder">
        <Boom message="bad screen" />
      </V2ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    rerender(
      <V2ErrorBoundary resetKey="home">
        <p>a different screen</p>
      </V2ErrorBoundary>,
    );
    expect(screen.getByText("a different screen")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers a retry, for a failure that was transient", async () => {
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error("first time only");
      return <p>recovered</p>;
    }

    render(
      <V2ErrorBoundary>
        <Flaky />
      </V2ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    shouldThrow = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("recovered")).toBeInTheDocument();
  });

  it("says something even when the error has no message", () => {
    render(
      <V2ErrorBoundary>
        <Boom message="" />
      </V2ErrorBoundary>,
    );
    // An empty error panel is indistinguishable from a broken error panel.
    expect(screen.getByRole("alert")).toHaveTextContent(/\S/);
  });
});
