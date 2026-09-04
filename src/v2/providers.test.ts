import { describe, expect, it } from "vitest";

/**
 * v2 mounts no providers of its own.
 *
 * React Query, Repositories, Library and Navigation all live above the version
 * branch in `App.tsx` and are shared with v1. A second `QueryClient` mounted
 * inside v2 would mean two caches, two sets of requests against a catalog that
 * already fails about a quarter of the time in bursts, and a sync racing
 * itself. None of that shows up as an error — it shows up as a screen that is
 * occasionally, inexplicably stale.
 *
 * This is a static check rather than a runtime one because "how many
 * QueryClients exist" is not a question the running app can be asked. Reading
 * the source can answer it, and it answers it for code nobody has written yet
 * — which is the point, with nine streams about to start.
 */

const SOURCES = import.meta.glob("./**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });

/** Things that create or re-root shared state. None may appear in `src/v2/`. */
const FORBIDDEN = [
  { pattern: /new\s+QueryClient\b/, why: "a second React Query cache" },
  { pattern: /<QueryClientProvider/, why: "a second React Query root" },
  { pattern: /new\s+Repositories\b/, why: "a second view of local storage" },
  { pattern: /<RepositoriesProvider/, why: "a second Repositories root" },
  { pattern: /<LibraryProvider/, why: "a second collection + sync engine" },
  { pattern: /<NavigationProvider/, why: "a second navigation stack" },
  { pattern: /<InputProvider/, why: "a second input adapter" },
];

describe("src/v2 mounts no providers", () => {
  it("has sources to check", () => {
    // A glob that silently matched nothing would make every assertion below
    // pass for the worst possible reason.
    expect(Object.keys(SOURCES).length).toBeGreaterThan(5);
  });

  it.each(FORBIDDEN)("never $why", ({ pattern, why }) => {
    const offenders = Object.entries(SOURCES)
      .filter(([path]) => !path.endsWith(".test.ts") && !path.endsWith(".test.tsx"))
      .filter(([, source]) => pattern.test(String(source)))
      .map(([path]) => path);

    expect(offenders, `${offenders.join(", ")} would create ${why}`).toEqual([]);
  });
});
