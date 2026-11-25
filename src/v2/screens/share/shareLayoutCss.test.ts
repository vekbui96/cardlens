import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Vitest runs from the repo root; jsdom's `import.meta.url` is not a file URL.
const css = readFileSync("src/v2/screens/share/share.module.css", "utf8");

/** The body of the `@media (min-width: 901px)` block, and the sheet with it removed. */
function split(): { wide: string; rest: string } {
  const start = css.search(/@media \(min-width: 901px\)/);
  if (start < 0) return { wide: "", rest: css };
  const open = css.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  return { wide: css.slice(open + 1, end), rest: css.slice(0, start) + css.slice(end + 1) };
}

describe("Trade share desktop layout (#304)", () => {
  it("centres and caps the cards section to 720px only above 900px", () => {
    const { wide, rest } = split();
    expect(wide).toMatch(/\.cardsSection\s*\{[^}]*max-width:\s*720px[^}]*margin-inline:\s*auto/);
    // Without it the auto margins shrink the section to fit its content and the
    // grid collapses to one stretched card (#304 review).
    expect(wide).toMatch(/\.cardsSection\s*\{[^}]*width:\s*100%/);
    expect(rest).not.toMatch(/\.cardsSection\s*\{/);
  });

  it("caps and centres the enlarged card's sheet to 560px only above 900px", () => {
    const { wide, rest } = split();
    expect(wide).toMatch(/:has\(\.enlarged\)\s*\{[^}]*max-width:\s*560px[^}]*margin-inline:\s*auto/);
    expect(rest).not.toMatch(/:has\(\.enlarged\)/);
  });
});
