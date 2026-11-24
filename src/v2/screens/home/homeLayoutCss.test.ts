import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Vitest runs from the repo root; jsdom's `import.meta.url` is not a file URL.
const css = readFileSync("src/v2/screens/home/Home.module.css", "utf8");

/** Split the sheet into the bodies of every `@media (min-width: 900px)` block and the rest. */
function split(): { wide: string; rest: string } {
  let wide = "";
  let rest = css;
  for (;;) {
    const start = rest.search(/@media \(min-width: 900px\)/);
    if (start < 0) break;
    const open = rest.indexOf("{", start);
    let depth = 0;
    let end = open;
    for (let i = open; i < rest.length; i++) {
      if (rest[i] === "{") depth++;
      if (rest[i] === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    wide += rest.slice(open + 1, end);
    rest = rest.slice(0, start) + rest.slice(end + 1);
  }
  return { wide, rest };
}

describe("Home desktop layout (#288)", () => {
  it("caps and centres the first-run card only above 900px", () => {
    const { wide, rest } = split();
    expect(wide).toMatch(/\.emptyWrap\s*\{[^}]*max-width:\s*720px[^}]*margin-inline:\s*auto/);
    // Nothing outside the media query caps it, so the phone layout is untouched.
    expect(rest).not.toMatch(/\.emptyWrap\s*\{[^}]*max-width/);
  });

  it("stretches the top row only above 900px so its cards share a height", () => {
    const { wide, rest } = split();
    expect(wide).toMatch(/\.top\s*\{[^}]*align-items:\s*stretch/);
    expect(rest).not.toMatch(/align-items:\s*stretch/);
  });
});
