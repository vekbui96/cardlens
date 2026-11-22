import { afterEach, describe, expect, it } from "vitest";
import { followThemeColor } from "./themeColor.ts";

/**
 * Installable on a phone, and clear of the notch (#126).
 *
 * The files are read as text through `import.meta.glob`, so a missing file is
 * an empty entry and a failed assertion — not an import error that hides every
 * other check in this file.
 */
const ROOT_FILES = import.meta.glob("../../../index.html", { query: "?raw", import: "default", eager: true });
const PUBLIC_TEXT = import.meta.glob("../../../public/*.{webmanifest,svg}", {
  query: "?raw",
  import: "default",
  eager: true,
});
/** Lazy: only the keys are used, to prove the files exist. */
const PUBLIC_ALL = import.meta.glob("../../../public/*");
const CSS = import.meta.glob(["./V2Shell.module.css", "../tokens.css"], {
  query: "?raw",
  import: "default",
  eager: true,
});

const indexHtml = String(ROOT_FILES["../../../index.html"] ?? "");
const manifestRaw = String(PUBLIC_TEXT["../../../public/manifest.webmanifest"] ?? "");
const shellCss = String(CSS["./V2Shell.module.css"] ?? "");
const tokensCss = String(CSS["../tokens.css"] ?? "");

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
}

function manifest(): Record<string, unknown> & { icons?: ManifestIcon[] } {
  expect(manifestRaw, "public/manifest.webmanifest is missing").not.toBe("");
  return JSON.parse(manifestRaw) as Record<string, unknown> & { icons?: ManifestIcon[] };
}

/** One CSS rule's body, by its exact selector. */
function rule(css: string, selector: string): string {
  const start = css.search(new RegExp(`^${selector.replace(".", "\\.")}\\s*\\{`, "m"));
  if (start < 0) return "";
  return css.slice(start, css.indexOf("}", start));
}

describe("the web app manifest", () => {
  it("is linked from index.html by a root path Vite prefixes with the Pages base", () => {
    // `/manifest.webmanifest` is a public-dir URL: the build rewrites it to
    // `/cardlens/manifest.webmanifest`. A relative href would be resolved as a
    // module import from the repo root instead.
    expect(indexHtml).toMatch(/<link\s+rel="manifest"\s+href="\/manifest\.webmanifest"/);
  });

  it("opens full screen, under the app's own path", () => {
    const m = manifest();
    expect(m.name).toBe("CardLens");
    expect(m.short_name).toBe("CardLens");
    expect(m.display).toBe("standalone");
    // Relative to the manifest's own URL, so they resolve to /cardlens/ on
    // Pages. "/" would be the GitHub Pages root, which is not this app.
    expect(m.start_url).toBe("./");
    expect(m.scope).toBe("./");
  });

  it("uses the v2 colours, which are tokens, so it is checked against them", () => {
    const m = manifest();
    const surface = /--v2-surface:\s*(#[0-9a-f]{6});/i.exec(tokensCss)?.[1];
    const bg = /--v2-bg:\s*(#[0-9a-f]{6});/i.exec(tokensCss)?.[1];
    expect(m.theme_color).toBe(surface);
    expect(m.background_color).toBe(bg);
  });

  it("names icons that exist, relative to the manifest", () => {
    const icons = manifest().icons ?? [];
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      expect(icon.src.startsWith("/"), `${icon.src} must be relative`).toBe(false);
      expect(Object.keys(PUBLIC_ALL), `${icon.src} is missing from public/`).toContain(
        `../../../public/${icon.src}`,
      );
    }
    // One scalable icon covers every size a launcher asks for.
    expect(icons).toContainEqual(expect.objectContaining({ sizes: "any", type: "image/svg+xml" }));
  });

  it("has an SVG icon that is an actual SVG", () => {
    expect(String(PUBLIC_TEXT["../../../public/icon.svg"] ?? "")).toMatch(/^<svg[\s>]/);
  });
});

describe("Add to Home Screen on iOS", () => {
  it("has the apple meta tags", () => {
    expect(indexHtml).toMatch(/<meta\s+name="apple-mobile-web-app-capable"\s+content="yes"/);
    expect(indexHtml).toMatch(/<meta\s+name="mobile-web-app-capable"\s+content="yes"/);
    expect(indexHtml).toMatch(/<meta\s+name="apple-mobile-web-app-title"\s+content="CardLens"/);
    // Translucent: the page draws under the status bar, which is why the
    // header reads `--v2-safe-top`.
    expect(indexHtml).toMatch(
      /<meta\s+name="apple-mobile-web-app-status-bar-style"\s+content="black-translucent"/,
    );
  });

  it("keeps the glasses' black theme-color in the document", () => {
    // The glasses display is additive: black is transparent. v2 changes it at
    // runtime only (see themeColor.ts).
    expect(indexHtml).toContain('<meta name="theme-color" content="#000000" />');
  });
});

describe("safe areas", () => {
  it("defines the insets as tokens, falling back to zero", () => {
    expect(tokensCss).toMatch(/--v2-safe-top:\s*env\(safe-area-inset-top,\s*0px\)/);
    expect(tokensCss).toMatch(/--v2-safe-left:\s*env\(safe-area-inset-left,\s*0px\)/);
    expect(tokensCss).toMatch(/--v2-safe-right:\s*env\(safe-area-inset-right,\s*0px\)/);
  });

  it("pads the sticky header below the status bar and inside the side insets", () => {
    const header = rule(shellCss, ".header");
    expect(header).toMatch(/padding-top:\s*var\(--v2-safe-top\)/);
    expect(header).toMatch(/height:\s*var\(--v2-header-offset\)/);
    expect(header).toMatch(/var\(--v2-safe-left\)/);
    expect(header).toMatch(/var\(--v2-safe-right\)/);
  });

  it("keeps the page gutter inside the side insets", () => {
    const content = rule(shellCss, ".content");
    expect(content).toMatch(/var\(--v2-safe-left\)/);
    expect(content).toMatch(/var\(--v2-safe-right\)/);
  });
});

describe("followThemeColor", () => {
  afterEach(() => {
    document.head.innerHTML = "";
  });

  function meta(content: string): HTMLMetaElement {
    const m = document.createElement("meta");
    m.name = "theme-color";
    m.content = content;
    document.head.appendChild(m);
    return m;
  }

  it("sets the colour while v2 is up and puts the glasses' black back after", () => {
    const m = meta("#000000");
    const restore = followThemeColor(document, "#141922");
    expect(m.content).toBe("#141922");
    restore();
    expect(m.content).toBe("#000000");
  });

  it("leaves the meta alone when there is no colour to set", () => {
    const m = meta("#000000");
    followThemeColor(document, "  ")();
    expect(m.content).toBe("#000000");
  });

  it("does nothing, and does not throw, on a document without the meta", () => {
    expect(() => followThemeColor(document, "#141922")()).not.toThrow();
  });
});
