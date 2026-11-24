import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Skeleton } from "./index.ts";

describe("Skeleton", () => {
  it("is a placeholder block that assistive technology skips", () => {
    const { container } = render(<Skeleton />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.hasAttribute("data-skeleton")).toBe(true);
  });

  it("takes the height it is given, so the real content lands where it was", () => {
    const { container } = render(<Skeleton height="3.8em" />);
    expect((container.firstElementChild as HTMLElement).style.height).toBe("3.8em");
  });

  it("stops pulsing under prefers-reduced-motion", () => {
    // jsdom has no layout or media queries; the rule is in the stylesheet, so
    // check the stylesheet says it.
    const css = readFileSync("src/v2/primitives/primitives.module.css", "utf8");
    const reduced = css.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.skeleton[^}]*animation:\s*none/s,
    );
    expect(reduced).not.toBeNull();
  });
});
