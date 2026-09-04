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

    await user.click(screen.getByRole("button", { name: "Delete Doomed" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete Doomed" }));

    expect(screen.queryByText("Doomed")).not.toBeInTheDocument();
    const records = new Repositories().getBinderRecords();
    expect(records).toHaveLength(1);
    expect(records[0].deletedAt).toBeGreaterThan(0);
  });

  it("does not delete on the first press, and lets the confirm be backed out of", async () => {
    // The delete writes a tombstone precisely so it survives a sync, which
    // means a misclick reaches every device and cannot be undone. One press
    // must not be enough.
    const user = userEvent.setup();
    render(<WebBindersScreen />, { wrapper: harness() });

    await user.type(screen.getByLabelText("Binder name"), "Safe");
    await user.click(screen.getByRole("button", { name: "Create binder" }));
    await screen.findByText("Safe");

    await user.click(screen.getByRole("button", { name: "Delete Safe" }));
    expect(screen.getByText("Safe")).toBeInTheDocument();
    expect(new Repositories().getBinders()).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Keep Safe" }));

    expect(screen.queryByRole("button", { name: "Confirm delete Safe" })).not.toBeInTheDocument();
    expect(new Repositories().getBinders()).toHaveLength(1);
  });

  it("shows the cover the binder was given, ahead of a page from inside it", async () => {
    // Setting a cover is a deliberate statement about what a binder IS, made
    // one screen in. The shelf is where it pays off — seeing it before you open
    // the binder is the entire point — so it wins over the page mosaic, which
    // is only ever a fallback nobody chose.
    render(<WebBindersScreen />, { wrapper: harness() });

    new Repositories().mergeIncomingBinders([
      {
        id: "with-cover",
        name: "Fronted",
        format: "9",
        cover: { kind: "card", cardId: "sv1-9", finish: "holo", imageSmall: "front.png" },
        pages: [
          { slots: { 0: { kind: "card", cardId: "sv1-1", finish: "normal", imageSmall: "inside.png" } } },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);

    const { container } = render(<WebBindersScreen />, { wrapper: harness() });
    await screen.findByText("Fronted");

    const art = container.querySelectorAll("img");
    expect(art).toHaveLength(1);
    expect(art[0]).toHaveAttribute("src", "front.png");
  });

  it("draws the binder's own card art on its cover, from the slot rather than the catalog", async () => {
    // The whole point of the shelf: a binder is recognised by what is in it.
    // The art is already denormalised onto the slot, so this must need no
    // catalog call at all — the harness's provider is given nothing.
    render(<WebBindersScreen />, { wrapper: harness() });

    new Repositories().mergeIncomingBinders([
      {
        id: "with-art",
        name: "Has art",
        format: "9",
        pages: [
          { slots: {} },
          // Not page 1: the cover is the first page that holds anything, or a
          // binder whose filling starts later reads as empty.
          { slots: { 4: { kind: "card", cardId: "sv1-1", finish: "normal", imageSmall: "art.png" } } },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);

    const { container } = render(<WebBindersScreen />, { wrapper: harness() });
    await screen.findByText("Has art");

    // Queried out of the DOM rather than by role: the cover is decorative in
    // full — alt="" on every thumbnail and aria-hidden on the page around them
    // — so it is deliberately absent from the accessibility tree, and a
    // getByRole("img") passing here would mean that had regressed.
    const art = container.querySelectorAll("img");
    expect(art).toHaveLength(1);
    expect(art[0]).toHaveAttribute("src", "art.png");
    expect(art[0]).toHaveAttribute("loading", "lazy");
    expect(art[0].closest("[aria-hidden='true']")).not.toBeNull();
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
