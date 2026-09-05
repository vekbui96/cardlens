import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
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
import { Repositories } from "../../../storage/repositories.ts";
import type { Binder, BinderSlot } from "../../../models/binderLayout.ts";
import { BindersScreen } from "./BindersScreen.tsx";

/**
 * The shelf's guarantees, as opposed to its markup.
 *
 * Two of these are the reason the screen is shaped the way it is: deleting a
 * binder writes a tombstone that SURVIVES a sync, so one press must never be
 * enough; and the art is decorative in full, so a screen reader must not be
 * offered a dozen unlabelled card images per tile.
 */

/**
 * The real providers, mounted once around the screen. v2 mounts none of its
 * own — `src/v2/providers.test.ts` fails the build if it does — so a test is
 * the only place in `src/v2/` where these appear.
 */
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

const NOW = 1_700_000_000_000;

function seed(...binders: Binder[]): void {
  const repo = new Repositories();
  for (const binder of binders) repo.saveBinder(binder);
}

/**
 * A binder whose one page is full, with art on every card.
 *
 * `zzz9` is deliberately a set the catalog has never heard of, so the pricing
 * path resolves to "cannot be priced" without a request — which is the state
 * the value tests below are actually about.
 */
function fullBinder(overrides: Partial<Binder> = {}): Binder {
  const slots: Record<number, BinderSlot> = {};
  for (let i = 0; i < 9; i++) {
    slots[i] = { kind: "card", cardId: `zzz9-${i}`, finish: "normal", imageSmall: `p${i}.png` };
  }
  return {
    id: "full",
    name: "Jolteon",
    format: "9",
    pages: [{ slots }],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

beforeEach(() => clearAllStorage());

describe("deleting a binder", () => {
  it("does not delete on the first press", async () => {
    /*
     * The delete writes a tombstone precisely so the deletion survives a sync,
     * which means a misclick reaches every device and cannot be undone. A
     * binder is also an evening of arrangement. One press must not be enough.
     */
    const user = userEvent.setup();
    seed(fullBinder({ name: "Safe" }));
    render(<BindersScreen />, { wrapper: harness() });

    await user.click(screen.getByRole("button", { name: "Delete Safe" }));

    expect(new Repositories().getBinders()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Confirm delete Safe" })).toBeInTheDocument();
  });

  it("can be backed out of, leaving the binder untouched", async () => {
    const user = userEvent.setup();
    seed(fullBinder({ name: "Safe" }));
    render(<BindersScreen />, { wrapper: harness() });

    await user.click(screen.getByRole("button", { name: "Delete Safe" }));
    await user.click(screen.getByRole("button", { name: "Keep Safe" }));

    expect(screen.queryByRole("button", { name: "Confirm delete Safe" })).not.toBeInTheDocument();
    expect(new Repositories().getBinders()).toHaveLength(1);
  });

  it("leaves a tombstone on the second press, so the deletion can sync", async () => {
    // The screen shows it gone; the store must still hold the record, or the
    // next pull from another device brings the binder straight back.
    const user = userEvent.setup();
    seed(fullBinder({ name: "Doomed" }));
    render(<BindersScreen />, { wrapper: harness() });

    await user.click(screen.getByRole("button", { name: "Delete Doomed" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete Doomed" }));

    expect(screen.queryByText("Doomed")).not.toBeInTheDocument();
    const records = new Repositories().getBinderRecords();
    expect(records).toHaveLength(1);
    expect(records[0].deletedAt).toBeGreaterThan(0);
  });

  it("asks over the binder it is about, naming it", async () => {
    // Over the tile rather than in a modal in the middle of the screen: what is
    // being deleted is the thing underneath, and a centred dialog makes you
    // remember which one you pressed.
    const user = userEvent.setup();
    seed(fullBinder({ name: "Jolteon" }), fullBinder({ id: "other", name: "Showcase" }));
    render(<BindersScreen />, { wrapper: harness() });

    await user.click(screen.getByRole("button", { name: "Delete Showcase" }));

    expect(screen.getByRole("group", { name: "Delete Showcase?" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Delete Jolteon?" })).not.toBeInTheDocument();
  });
});

describe("the art", () => {
  it("is absent from the accessibility tree entirely", () => {
    /*
     * `getByRole("img")` must find NOTHING here. A 12-pocket shelf of six
     * binders is seventy-two thumbnails, none of which a screen reader can act
     * on and none of which says anything the tile's button does not already
     * say in words.
     */
    seed(fullBinder(), fullBinder({ id: "cover", name: "Fronted", cover: fullBinder().pages[0].slots[0] }));
    render(<BindersScreen />, { wrapper: harness() });

    expect(screen.queryAllByRole("img")).toEqual([]);
  });

  it("says everything the picture says, in the tile's own name", () => {
    seed(fullBinder({ name: "Jolteon", format: "12" }));
    render(<BindersScreen />, { wrapper: harness() });

    expect(
      screen.getByRole("button", { name: "Jolteon, 12-pocket, 9 of 12 pockets filled" }),
    ).toBeInTheDocument();
  });

  it("shows the cover the binder was given, ahead of a page from inside it", () => {
    // Setting a cover is a deliberate statement about what a binder IS, made
    // one screen in. Seeing it before you open the binder is the entire point.
    const { container } = renderSeeded(
      fullBinder({
        name: "Fronted",
        cover: { kind: "card", cardId: "zzz9-99", finish: "holo", imageSmall: "front.png" },
      }),
    );

    const art = container.querySelectorAll("img");
    expect(art).toHaveLength(1);
    expect(art[0].getAttribute("src")).toContain("front.png");
  });

  it("costs no fetch and nothing below the fold", () => {
    /*
     * The art is already on the slot — `CardSlot` carries `imageSmall`
     * denormalised — so the shelf issues no catalog call at all, and the images
     * it does reference are lazy. The harness gives the catalog provider
     * nothing, so anything asking it would come back empty.
     */
    const { container } = renderSeeded(fullBinder());
    const art = [...container.querySelectorAll("img")];

    expect(art).toHaveLength(9);
    expect(art.every((img) => img.getAttribute("loading") === "lazy")).toBe(true);
    expect(art.map((img) => img.getAttribute("src") ?? "")).toEqual(
      expect.arrayContaining([expect.stringContaining("p0.png")]),
    );
  });
});

describe("what a binder is worth", () => {
  it("shows nothing at all for a binder that did not opt in", () => {
    // Pricing one binder is a request per set it spans — the Riolu binder
    // alone touches thirty — so the shelf asks for nothing unless asked to.
    renderSeeded(fullBinder());
    expect(screen.queryByText(/Unavailable|Pricing/)).not.toBeInTheDocument();
  });

  it("never prints $0.00 for a binder nothing can price", () => {
    // An unpriced binder and a worthless one are not the same binder. The set
    // here is unknown to the catalog, which is exactly the unpriceable case.
    renderSeeded(fullBinder({ showValue: true }));

    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
    expect(screen.getByText(/9 unpriced/)).toBeInTheDocument();
  });
});

describe("an empty shelf", () => {
  it("is the create tile alone, with no summary to state", () => {
    // "0 binders · 0 cards" is a fact nobody needed stated twice, and the old
    // "No binders yet" notice sat UNDER the form that answered it.
    render(<BindersScreen />, { wrapper: harness() });

    expect(screen.getByRole("button", { name: "Create binder" })).toBeInTheDocument();
    expect(screen.queryByText(/0 binders/)).not.toBeInTheDocument();
  });

  it("creates a binder and puts it on the shelf", async () => {
    const user = userEvent.setup();
    render(<BindersScreen />, { wrapper: harness() });

    await user.type(screen.getByLabelText("Binder name"), "Master set");
    await user.click(screen.getByRole("button", { name: "12-pocket" }));
    await user.click(screen.getByRole("button", { name: "Create binder" }));

    expect(await screen.findByText("Master set")).toBeInTheDocument();
    expect(new Repositories().getBinders()[0].format).toBe("12");
  });
});

/** Seed storage first, then mount: the library reads the store once, at mount. */
function renderSeeded(...binders: Binder[]) {
  seed(...binders);
  return render(<BindersScreen />, { wrapper: harness() });
}
