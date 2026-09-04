import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Card, CardArt, Chip, Meter, Money, Panel } from "./index.ts";

/**
 * These cover the decisions, not the markup.
 *
 * Each one below is a rule the primitives exist to enforce across nine screens
 * built in parallel — an unpriced card is not a free card, a surface that looks
 * pressable must actually press, decorative art must not be read aloud. Testing
 * that a div has a class would tell us nothing and break on every restyle.
 */

describe("Money", () => {
  it("renders a price", () => {
    render(<Money value={412.5} />);
    expect(screen.getByText("$412.50")).toBeInTheDocument();
  });

  it("says Unavailable rather than $0.00 when there is no price", () => {
    // The bug this component exists for: an unpriced card and a free card look
    // identical once both render as zero, and one of them is worth $400.
    render(<Money value={undefined} />);
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("treats zero as absent, not as free", () => {
    render(<Money value={0} />);
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });

  it("says Pricing… while in flight", () => {
    render(<Money value={undefined} loading />);
    expect(screen.getByText("Pricing…")).toBeInTheDocument();
  });

  it("takes a screen's own word for absent", () => {
    render(<Money value={undefined} absentLabel="Not for sale" />);
    expect(screen.getByText("Not for sale")).toBeInTheDocument();
  });
});

describe("Meter", () => {
  it("reports progress to assistive technology", () => {
    render(<Meter value={0.42} label="Base set" detail="43 / 102" />);
    const bar = screen.getByRole("progressbar", { name: "Base set" });
    expect(bar).toHaveAttribute("aria-valuenow", "42");
  });

  it("clamps a ratio above one", () => {
    render(<Meter value={2} label="Overfull" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("treats an empty set's 0/0 as zero rather than NaN", () => {
    // A completion ratio is a division, and an empty set makes it 0/0. As a bar
    // width NaN renders as nothing at all, which reads as "you have none of
    // this" rather than "there is nothing to have".
    render(<Meter value={Number.NaN} label="Empty set" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("can hide its text row for a tile that already says it in words", () => {
    render(<Meter value={0.5} label="Quiet" detail="half" labelHidden />);
    expect(screen.queryByText("half")).not.toBeInTheDocument();
    // Still announced, though — hiding the text must not hide the meaning.
    expect(screen.getByRole("progressbar", { name: "Quiet" })).toBeInTheDocument();
  });
});

describe("CardArt", () => {
  it("names the card for a screen reader", () => {
    render(<CardArt src="https://example.test/a.png" name="Jolteon" />);
    expect(screen.getByRole("img", { name: "Jolteon" })).toBeInTheDocument();
  });

  it("is silent when decorative", () => {
    // A binder tile already says its name in its button label; reading nine
    // card names after it gives a screen-reader user a list they cannot act on.
    const { container } = render(<CardArt src="https://example.test/a.png" name="Jolteon" decorative />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
  });

  it("draws a card face-down when there is no art, not an empty pocket", () => {
    // A full binder that reads as empty is a worse lie than a slow one.
    render(<CardArt name="Jolteon VMAX" />);
    expect(screen.getByText("Jolteon VMAX")).toBeInTheDocument();
  });

  it("asks the CDN for more pixels at higher detail", () => {
    const { container: tile } = render(<CardArt src="https://example.test/a.png" name="A" detail="tile" />);
    const { container: hero } = render(<CardArt src="https://example.test/a.png" name="A" detail="hero" />);
    const width = (c: HTMLElement) => new URL(c.querySelector("img")!.src).searchParams.get("w");
    expect(Number(width(hero))).toBeGreaterThan(Number(width(tile)));
  });

  it("lazy-loads by default", () => {
    const { container } = render(<CardArt src="https://example.test/a.png" name="A" />);
    expect(container.querySelector("img")).toHaveAttribute("loading", "lazy");
  });
});

describe("Card", () => {
  it("is a button when it does something", async () => {
    const onPress = vi.fn();
    render(<Card onPress={onPress}>Press me</Card>);
    await userEvent.click(screen.getByRole("button", { name: "Press me" }));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("is a link when it has a URL", () => {
    render(<Card href="#/binders">Binders</Card>);
    expect(screen.getByRole("link", { name: "Binders" })).toHaveAttribute("href", "#/binders");
  });

  it("is inert when it does nothing", () => {
    // A surface that looks pressable and is not is the most common way a UI
    // lies. Without a handler there is no button role to find.
    render(<Card>Just content</Card>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Just content")).toBeInTheDocument();
  });
});

describe("Panel", () => {
  it("takes its heading level from the caller", () => {
    // A page whose headings skip a level is a page a screen reader cannot
    // outline, and only the caller knows how deep the panel sits.
    render(
      <Panel title="Nested" headingLevel={3}>
        body
      </Panel>,
    );
    expect(screen.getByRole("heading", { name: "Nested", level: 3 })).toBeInTheDocument();
  });
});

describe("Chip", () => {
  it("is a button with a real pressed state when it toggles", async () => {
    const onPress = vi.fn();
    render(
      <Chip onPress={onPress} pressed={false}>
        For trade
      </Chip>,
    );
    const chip = screen.getByRole("button", { name: "For trade" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(chip);
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("is plain text when it is only a label", () => {
    render(<Chip>9-pocket</Chip>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
