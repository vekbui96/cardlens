import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  InputProvider,
  CatalogProvider,
  RepositoriesProvider,
  LayoutModeProvider,
} from "../../app/contexts.tsx";
import { NavigationProvider } from "../../app/NavigationProvider.tsx";
import { LibraryProvider } from "../../app/LibraryProvider.tsx";
import { MockInputAdapter } from "../../integrations/meta/MockInputAdapter.ts";
import { MockPokemonProvider } from "../../integrations/pokemon/index.ts";
import { clearAllStorage } from "../../storage/versioned.ts";
import { Repositories } from "../../storage/repositories.ts";
import { WebBindersScreen } from "./WebBindersScreen.tsx";

function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

beforeEach(() => clearAllStorage());

describe("WebBindersScreen", () => {
  it("creates a binder and shows it in the list", async () => {
    const user = userEvent.setup();
    render(<WebBindersScreen />, { wrapper: harness() });

    await user.type(screen.getByLabelText("Binder name"), "Master set");
    await user.click(screen.getByRole("button", { name: "Create binder" }));

    expect(await screen.findByText("Master set")).toBeInTheDocument();
  });

  it("leaves a tombstone when a binder is deleted, so the deletion can sync", async () => {
    // The screen shows it gone; the store must still hold the record, or the
    // next pull from another device brings the binder straight back.
    const user = userEvent.setup();
    render(<WebBindersScreen />, { wrapper: harness() });

    await user.type(screen.getByLabelText("Binder name"), "Doomed");
    await user.click(screen.getByRole("button", { name: "Create binder" }));
    await screen.findByText("Doomed");

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.queryByText("Doomed")).not.toBeInTheDocument();
    const records = new Repositories().getBinderRecords();
    expect(records).toHaveLength(1);
    expect(records[0].deletedAt).toBeGreaterThan(0);
  });

  it("lists a binder that arrived by merge alongside one made here", async () => {
    // Merging must not be a replace: a pull carrying another device's binder
    // has to land beside this device's own, not over it.
    const user = userEvent.setup();
    render(<WebBindersScreen />, { wrapper: harness() });

    await user.type(screen.getByLabelText("Binder name"), "Mine");
    await user.click(screen.getByRole("button", { name: "Create binder" }));
    await screen.findByText("Mine");

    // A second binder arriving the way a pull delivers one.
    new Repositories().mergeIncomingBinders([
      {
        id: "from-phone",
        name: "From the phone",
        format: "12",
        pages: [{ slots: {} }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);

    const records = new Repositories().getBinders();
    expect(records.map((b) => b.name).sort()).toEqual(["From the phone", "Mine"]);

    // And a fresh mount reads both from the store rather than from whatever the
    // first screen happened to capture.
    render(<WebBindersScreen />, { wrapper: harness() });
    expect(await screen.findByText("From the phone")).toBeInTheDocument();
  });
});
