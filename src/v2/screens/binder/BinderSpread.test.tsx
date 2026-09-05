import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  emptyBinder,
  pageGroups,
  placeSlot,
  setCover,
  type Binder,
  type BinderFormat,
  type BinderSlot,
} from "../../../models/binderLayout.ts";
import { BinderSpread } from "./BinderSpread.tsx";

/**
 * The piece the share pages also render.
 *
 * Everything here is about the CONTRACT rather than the pixels: who decides
 * ownership, what a pocket is when nobody may press it, and the fact that the
 * cover is not one of the pockets. A share page that got any of these wrong
 * would show the recipient a different binder from the one its owner laid out,
 * which is the whole reason this component is shared instead of copied.
 */

const NOW = 1_700_000_000_000;
const jolteon: BinderSlot = { kind: "card", cardId: "base2-4", finish: "holo", name: "Jolteon" };
const flareon: BinderSlot = { kind: "card", cardId: "base2-3", finish: "holo", name: "Flareon" };

function binder(format: BinderFormat = "9"): Binder {
  return placeSlot(emptyBinder("b", "Eeveelutions", format, NOW), 0, 0, jolteon, NOW);
}

const ownsEverything = () => true;
const ownsNothing = () => false;

describe("read-only mode", () => {
  it("renders pockets that are not buttons, because there is nothing to press", () => {
    // A surface that looks pressable and is not is how a UI lies. A share page
    // passes no onSelect and gets images with the same accessible names.
    render(<BinderSpread binder={binder()} pages={[0]} owns={ownsEverything} />);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByRole("img", { name: "Pocket 1, Jolteon, owned" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Pocket 2, empty" })).toBeInTheDocument();
  });

  it("becomes buttons the moment a caller offers onSelect", () => {
    const onSelect = vi.fn();
    render(<BinderSpread binder={binder()} pages={[0]} owns={ownsEverything} onSelect={onSelect} />);

    // Nine pockets plus the cover, which is a real slot before page 1.
    expect(screen.getAllByRole("button")).toHaveLength(10);
  });
});

describe("ownership is the caller's answer", () => {
  it("marks a card the predicate rejects, and keeps it in the pocket", () => {
    // Planning around gaps is the point of laying a binder out, so an unowned
    // card must stay placeable and visibly distinct — shadowed AND tagged,
    // because colour is never the only carrier of meaning.
    render(<BinderSpread binder={binder()} pages={[0]} owns={ownsNothing} />);

    expect(screen.getByRole("img", { name: "Pocket 1, Jolteon, not owned" })).toBeInTheDocument();
    expect(screen.getByText("Don’t own")).toBeInTheDocument();
  });

  it("judges against the SHARER's collection, whatever the viewer holds", () => {
    // The share page passes a predicate built from the sharer's rows. This is
    // that contract: the component asks, and never looks anything up itself.
    const sharerOwns = vi.fn((slot: BinderSlot) => slot.kind === "card" && slot.cardId === "base2-4");
    const two = placeSlot(binder(), 0, 1, flareon, NOW);
    render(<BinderSpread binder={two} pages={[0]} owns={sharerOwns} />);

    expect(screen.getByRole("img", { name: "Pocket 1, Jolteon, owned" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Pocket 2, Flareon, not owned" })).toBeInTheDocument();
  });
});

describe("the cover", () => {
  it("is drawn beside page 1, named, and is not a numbered pocket", () => {
    const withCover = setCover(binder(), flareon, NOW);
    render(<BinderSpread binder={withCover} pages={[0]} owns={ownsEverything} />);

    expect(screen.getByRole("img", { name: "Cover, Flareon" })).toBeInTheDocument();
    // Nine pockets, and not one of them is the cover.
    expect(screen.getAllByRole("img", { name: /^Pocket \d/ })).toHaveLength(9);
  });

  it("is absent from a later spread, because a binder has one front", () => {
    let b = emptyBinder("b", "Eeveelutions", "9", NOW);
    for (let i = 0; i < 3; i++) b = placeSlot(b, i, 0, jolteon, NOW);
    render(<BinderSpread binder={b} pages={[1, 2]} owns={ownsEverything} />);

    expect(screen.queryByRole("img", { name: /^Cover/ })).not.toBeInTheDocument();
  });

  it("reads as empty rather than nagging, which is the normal state for a binder", () => {
    render(<BinderSpread binder={binder()} pages={[0]} owns={ownsEverything} />);
    expect(screen.getByRole("img", { name: "Cover, empty" })).toBeInTheDocument();
  });
});

describe("the geometry the format asks for", () => {
  it("draws as many pockets as the format has, and says which format it is", () => {
    const { container } = render(<BinderSpread binder={binder("12")} pages={[0]} owns={ownsEverything} />);

    expect(screen.getAllByRole("img", { name: /^Pocket \d/ })).toHaveLength(12);
    expect(container.querySelector("[data-binder-format]")).toHaveAttribute("data-binder-format", "12");
  });

  it("marks 4-pocket as solo, because two 2-column pages abreast read as a 12", () => {
    // The stylesheet keys the column count off this. Without it a 4-pocket
    // binder would be indistinguishable from a 12-pocket one at a glance — see
    // hasFacingPages.
    const { container } = render(<BinderSpread binder={binder("4")} pages={[0]} owns={ownsEverything} />);

    expect(container.querySelector("[data-solo]")).not.toBeNull();
    expect(container.querySelector("[data-cover]")).toBeNull();
  });

  it("opens page 1 against the inside cover, and pairs the rest facing each other", () => {
    // A binder opens on a RIGHT-hand page, the same reason a book's first page
    // is. A trailing even page is NOT marked: it sits on the left with its
    // facing side still to be added.
    let b = emptyBinder("b", "Eeveelutions", "9", NOW);
    for (let i = 0; i < 3; i++) b = placeSlot(b, i, 0, jolteon, NOW);
    const groups = pageGroups(b.pages.length, b.format);

    const first = render(<BinderSpread binder={b} pages={groups[0]} owns={ownsEverything} />);
    expect(first.container.querySelector("[data-cover]")).not.toBeNull();
    first.unmount();

    const rest = render(<BinderSpread binder={b} pages={groups[1]} owns={ownsEverything} />);
    expect(rest.container.querySelector("[data-cover]")).toBeNull();
    expect(screen.getByRole("heading", { name: "Page 2" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Page 3" })).toBeInTheDocument();
  });
});

describe("prices and trade marks", () => {
  it("says n/a rather than nothing, because a blank reads as still loading", () => {
    // Whole categories cannot be priced at all — stamps and promos ride on
    // finishes the oracle has never heard of.
    render(<BinderSpread binder={binder()} pages={[0]} owns={ownsEverything} priceFor={() => undefined} />);

    expect(screen.getByRole("img", { name: "Pocket 1, Jolteon, owned, n/a" })).toBeInTheDocument();
  });

  it("shows no prices at all when the caller offers none", () => {
    render(<BinderSpread binder={binder()} pages={[0]} owns={ownsEverything} />);
    expect(screen.queryByText("n/a")).not.toBeInTheDocument();
  });

  it("adds the pocket address and the stock in trade mode, and nothing when there is none", () => {
    // A trade is negotiated by saying "page 1, pocket 1" out loud, and copies
    // and grade are what the other collector is deciding about. A single
    // ungraded copy prints nothing: "x1" on every pocket is noise.
    const traded = placeSlot(binder(), 0, 1, { ...flareon, quantity: 3, condition: "LP" }, NOW);
    render(<BinderSpread binder={traded} pages={[0]} owns={ownsEverything} trade />);

    expect(
      screen.getByRole("img", { name: /^Page 1, Pocket 2, Flareon, owned, 3 copies, Lightly played$/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("×3 LP")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Page 1, Pocket 1, Jolteon, owned" })).toBeInTheDocument();
  });

  it("condition never becomes a price", () => {
    // The oracles publish one market price per printing and say nothing about
    // what condition it assumes. Any multiplier here would be a number this app
    // invented and then showed beside real ones.
    const priceFor = vi.fn(() => 10);
    const graded = placeSlot(binder(), 0, 1, { ...flareon, condition: "DMG" }, NOW);
    render(<BinderSpread binder={graded} pages={[0]} owns={ownsEverything} priceFor={priceFor} trade />);

    expect(screen.getAllByText("$10.00")).toHaveLength(2);
  });
});
