import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ValueRow } from "../../../models/valueHistory.ts";
import { ValueChart } from "./ValueChart.tsx";
import { VALUE_RANGE_KEY } from "./valueRange.ts";

const TODAY = "2026-11-21";

function row(day: string, total: number, priced = 400, printings = 480): ValueRow {
  return { day, total, priced, printings, currency: "USD" };
}

describe("ValueChart", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.removeItem(VALUE_RANGE_KEY);
  });

  it("opens on the range that was last chosen", () => {
    const state = { status: "ready" as const, rows: [row("2026-11-01", 100)] };
    const first = render(<ValueChart state={state} today={TODAY} />);
    expect(screen.getByRole("button", { name: "30 days" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "90 days" }));
    first.unmount();

    render(<ValueChart state={state} today={TODAY} />);
    expect(screen.getByRole("button", { name: "90 days" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "30 days" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("says tracking has started when the server has no rows yet", () => {
    render(<ValueChart state={{ status: "ready", rows: [] }} today={TODAY} />);
    expect(screen.getByRole("heading", { name: "Value over time" })).toBeTruthy();
    expect(screen.getByText("Value tracking starts today: first point saved")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("shows a single day as a dot with its value and its coverage", () => {
    const { container } = render(
      <ValueChart state={{ status: "ready", rows: [row(TODAY, 7172.64, 2184, 2363)] }} today={TODAY} />,
    );
    const point = screen.getByRole("button", { name: /\$7,172\.64, 2,184 of 2,363 printings priced/ });
    expect(point.getAttribute("aria-pressed")).toBe("true");
    // No line to draw from one point: the dot carries it.
    expect(container.querySelectorAll("path")).toHaveLength(0);
    expect(container.textContent).toContain("$7,172.64");
    expect(container.textContent).toContain("2,184 of 2,363 printings priced");
  });

  it("shows the tapped day's value and coverage", () => {
    const { container } = render(
      <ValueChart
        state={{
          status: "ready",
          rows: [row("2026-11-19", 400, 412), row("2026-11-20", 450), row(TODAY, 500)],
        }}
        today={TODAY}
      />,
    );
    // The newest day is the default reading.
    expect(container.textContent).toContain("$500.00");

    fireEvent.click(screen.getByRole("button", { name: /\$400\.00/ }));
    expect(container.textContent).toContain("$400.00");
    expect(container.textContent).toContain("412 of 480 printings priced");
    expect(screen.getByRole("button", { name: /\$400\.00/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("draws one path per run of days, never one across a gap", () => {
    const { container } = render(
      <ValueChart
        state={{
          status: "ready",
          rows: [row("2026-11-16", 1), row("2026-11-17", 2), row("2026-11-19", 3), row("2026-11-20", 4)],
        }}
        today={TODAY}
      />,
    );
    expect(container.querySelectorAll("path")).toHaveLength(2);
  });

  it("changes the window with the range chips", () => {
    render(<ValueChart state={{ status: "ready", rows: [row("2026-11-01", 100)] }} today={TODAY} />);
    // Twenty days back: inside 30 days, outside 7.
    expect(screen.getByRole("button", { name: /\$100\.00/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "7 days" }));
    expect(screen.queryByRole("button", { name: /\$100\.00/ })).toBeNull();
    expect(screen.getByText("No priced days in the last 7 days.")).toBeTruthy();
  });

  it("says where the history lives when this device has no sync token", () => {
    render(<ValueChart state={{ status: "off" }} today={TODAY} />);
    expect(screen.getByText(/Connect this device in Settings/)).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("holds the plot's place while loading", () => {
    render(<ValueChart state={{ status: "loading" }} today={TODAY} />);
    expect(screen.getByRole("status", { name: "Loading value history" })).toBeTruthy();
  });

  it("draws nothing at all when the history could not be read", () => {
    const { container } = render(<ValueChart state={{ status: "hidden" }} today={TODAY} />);
    expect(container.innerHTML).toBe("");
  });
});
