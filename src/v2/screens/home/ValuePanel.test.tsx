import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ValuePanel } from "./ValuePanel.tsx";
import type { PricingInput } from "./homeSummary.ts";

function pricing(over: Partial<PricingInput> = {}): PricingInput {
  return {
    printings: 5,
    priced: 0,
    pending: 5,
    failed: 0,
    bySet: [],
    setNames: {},
    setsLoaded: true,
    ...over,
  };
}

function renderPanel(input: PricingInput, total = 0) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ValuePanel total={total} movement={{ contributing: 0 }} pricing={input} />
    </QueryClientProvider>,
  );
}

describe("Home ValuePanel while prices load", () => {
  it("holds the total's place with a skeleton block, not text that changes width", () => {
    renderPanel(pricing());
    const skeleton = screen.getByTestId("home-total-skeleton");
    expect(skeleton).toHaveAttribute("aria-label", "Pricing your collection");
    expect(screen.queryByText("Pricing…")).toBeNull();
    expect(screen.getByText("Pricing 5 sets…")).toBeInTheDocument();
  });

  it("shows the total once something is priced", () => {
    renderPanel(pricing({ priced: 2, pending: 3 }), 25);
    expect(screen.queryByTestId("home-total-skeleton")).toBeNull();
    expect(screen.getByText("$25.00")).toBeInTheDocument();
  });

  it("says how far along a rate limited batch is instead of dashes", () => {
    renderPanel(pricing({ priced: 2, pending: 3, rateLimited: 3, retrying: 3 }), 25);
    expect(screen.getByText("Prices are slow right now: 2 of 5 priced, retrying")).toBeInTheDocument();
  });
});
