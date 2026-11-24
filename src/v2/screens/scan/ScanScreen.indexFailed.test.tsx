import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
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
import { clearAllStorage } from "../../../storage/versioned.ts";

vi.mock("../../../scan/cardIndex.ts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadCardIndex: vi.fn(() => Promise.reject(new Error("HTTP 500"))),
  resetCardIndex: vi.fn(),
}));

import { ScanScreen } from "./ScanScreen.tsx";

/**
 * When the on-device card list fails to download and no server token is set,
 * nothing can identify a card. The screen has to say so in the chip and the
 * status line, not just in the alert, or scanning looks merely idle.
 */

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
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
}

beforeEach(() => clearAllStorage());

describe("ScanScreen when the card index failed on a device with no server token", () => {
  it("labels the engine chip and the status line 'Needs the card list'", async () => {
    render(<ScanScreen />, { wrapper: Wrapper });

    // The failure alert proves the index state reached "failed".
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Reason: HTTP 500")).toBeInTheDocument();

    // Chip beside the viewfinder, and the status line under the camera.
    expect(screen.getAllByText("Needs the card list").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("Recognition runs on this device.")).toBeNull();
    expect(screen.queryByText("On device")).toBeNull();
  });

  it("shows Start camera as aria-disabled with the reason beside it", async () => {
    render(<ScanScreen />, { wrapper: Wrapper });
    await screen.findByRole("alert");
    const start = await screen.findByRole("button", { name: "Start camera" });
    expect(start).toHaveAttribute("aria-disabled", "true");
    expect(start.parentElement).toHaveTextContent("Needs the card list");
  });
});
