#!/usr/bin/env node
/**
 * Assert that a v1 user downloads none of v2.
 *
 * The entire toggle arrangement rests on one lazy import in `src/app/App.tsx`.
 * That is a single line, and it is undone silently: one eager `import` from a
 * shared module into `src/v2/` — a type that is actually a value, a helper
 * someone moved for convenience — and Rollup folds the whole rebuild into the
 * entry chunk that every existing user fetches on every visit. Nothing about
 * the app looks different when that happens.
 *
 * So it is checked against the built output, on every build, rather than
 * reasoned about. Runs as `postbuild`, so `npm run build` cannot skip it.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const DIST = join(ROOT, "dist");
const ASSETS = join(DIST, "assets");

if (!existsSync(ASSETS)) {
  console.error("check-v2-split: no dist/assets — run `npm run build` first.");
  process.exit(1);
}

/**
 * Strings that exist ONLY in v2. Both are things a person wrote once, in one
 * place, and would have to deliberately duplicate: the switch's accessible
 * group name, and the pocket token.
 */
const MARKERS = [
  { text: "Interface version", where: "src/v2/shell/VersionSwitch.tsx" },
  { text: "--v2-pocket", where: "src/v2/tokens.css" },
];

const html = readFileSync(join(DIST, "index.html"), "utf8");

/** What the browser fetches before it has run a single line of our code. */
const eager = new Set();
for (const m of html.matchAll(/(?:src|href)="[^"]*?assets\/([^"]+)"/g)) eager.add(m[1]);

if (eager.size === 0) {
  console.error("check-v2-split: parsed no assets out of dist/index.html — the build shape changed.");
  process.exit(1);
}

const failures = [];
for (const file of eager) {
  const path = join(ASSETS, file);
  if (!existsSync(path)) continue;
  const source = readFileSync(path, "utf8");
  for (const marker of MARKERS) {
    if (source.includes(marker.text)) {
      failures.push({ file, marker });
    }
  }
}

/*
 * And the other half of the claim: v2 has to be somewhere. A marker missing
 * from the whole build would pass the check above for the worst possible
 * reason — the code was dropped, not split.
 */
const all = readdirSync(ASSETS);
for (const marker of MARKERS) {
  const found = all.some((f) => {
    if (!/\.(js|css)$/.test(f)) return false;
    return readFileSync(join(ASSETS, f), "utf8").includes(marker.text);
  });
  if (!found) {
    console.error(
      `check-v2-split: "${marker.text}" is in no built asset at all.\n` +
        `  It should be in a lazy chunk, from ${marker.where}. Missing entirely\n` +
        `  means v2 was dropped from the build, not split out of the entry.`,
    );
    process.exit(1);
  }
}

if (failures.length > 0) {
  console.error("\ncheck-v2-split: v2 leaked into the entry bundle.\n");
  for (const f of failures) {
    console.error(`  ${f.file} contains "${f.marker.text}" (from ${f.marker.where})`);
  }
  console.error(
    "\nSomething now imports src/v2/ eagerly. Find it with:\n" +
      "  npx vite build --mode production && npx vite-bundle-visualizer\n" +
      "The only permitted entry into v2 is the lazy import in src/app/App.tsx.\n",
  );
  process.exit(1);
}

console.log(`v2 split: ok (${eager.size} eager assets, none containing v2)`);
